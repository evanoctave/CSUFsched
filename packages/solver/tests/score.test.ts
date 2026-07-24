import { describe, it, expect } from 'vitest';
import { totalGapMinutes, daysOnCampus, avgProfRating, scoreCombo } from '../src/score';
import { mkSection, mkProf } from './helpers';
import type { SolverPrefs } from '@csufsched/types';

const prefs: SolverPrefs = {
  avoidDays: [],
  maxUnits: 18,
  weightProfRating: 1,
  weightMinimizeGaps: 1,
};

describe('totalGapMinutes', () => {
  it('sums gaps between consecutive classes per day', () => {
    const a = mkSection([{ days: ['M'], startMin: 600, endMin: 650 }]); // 10:00–10:50
    const b = mkSection([{ days: ['M'], startMin: 720, endMin: 770 }]); // 12:00–12:50
    expect(totalGapMinutes([a, b])).toBe(70);
  });

  it('returns 0 for back-to-back classes', () => {
    const a = mkSection([{ days: ['M'], startMin: 600, endMin: 650 }]);
    const b = mkSection([{ days: ['M'], startMin: 650, endMin: 700 }]);
    expect(totalGapMinutes([a, b])).toBe(0);
  });

  it('counts gaps independently per day', () => {
    const a = mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 650 }]);
    const b = mkSection([{ days: ['M', 'W'], startMin: 680, endMin: 730 }]);
    expect(totalGapMinutes([a, b])).toBe(60); // 30 on M + 30 on W
  });
});

describe('daysOnCampus', () => {
  it('counts distinct meeting days', () => {
    const a = mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 650 }]);
    const b = mkSection([{ days: ['W', 'F'], startMin: 720, endMin: 770 }]);
    expect(daysOnCampus([a, b])).toBe(3);
  });

  it('returns 0 for all-online schedule', () => {
    expect(daysOnCampus([mkSection([])])).toBe(0);
  });
});

describe('avgProfRating', () => {
  it('averages ratings, treating null as neutral 3.0', () => {
    const rated = mkSection([], { professor: mkProf(5) });
    const unrated = mkSection([], { professor: null });
    expect(avgProfRating([rated, unrated])).toBe(4);
  });

  it('returns neutral 3 for an empty section list', () => {
    expect(avgProfRating([])).toBe(3);
  });
});

describe('scoreCombo', () => {
  it('scores higher-rated, tighter schedules better', () => {
    const good = [
      mkSection([{ days: ['M'], startMin: 600, endMin: 650 }], { professor: mkProf(5) }),
      mkSection([{ days: ['M'], startMin: 650, endMin: 700 }], { professor: mkProf(5) }),
    ];
    const bad = [
      mkSection([{ days: ['M'], startMin: 480, endMin: 530 }], { professor: mkProf(1.5) }),
      mkSection([{ days: ['W'], startMin: 900, endMin: 950 }], { professor: mkProf(1.5) }),
    ];
    expect(scoreCombo(good, prefs)).toBeGreaterThan(scoreCombo(bad, prefs));
  });

  it('computes exact score for a known schedule', () => {
    // one M class, prof 5.0, no gaps: ratingScore 1, gapScore 1, dayScore 5/6
    const combo = [mkSection([{ days: ['M'], startMin: 600, endMin: 650 }], { professor: mkProf(5) })];
    expect(scoreCombo(combo, prefs)).toBeCloseTo(100 * (1 + 1 + 0.2 * (5 / 6)));
  });

  it('clamps gap score at 0 when gaps exceed 480 minutes', () => {
    const combo = [
      mkSection([{ days: ['M'], startMin: 480, endMin: 530 }], { professor: mkProf(3) }),
      mkSection([{ days: ['M'], startMin: 1200, endMin: 1250 }], { professor: mkProf(3) }),
    ];
    // 670 min gap → gapScore 0; ratingScore 0.5; dayScore 5/6
    expect(scoreCombo(combo, prefs)).toBeCloseTo(100 * (0.5 + 0 + 0.2 * (5 / 6)));
  });
});
