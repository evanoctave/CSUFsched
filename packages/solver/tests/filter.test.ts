import { describe, it, expect } from 'vitest';
import { filterSections } from '../src/filter';
import { mkCourse, mkSection } from './helpers';
import type { SolverPrefs } from '@csufsched/types';

const basePrefs: SolverPrefs = {
  avoidDays: [],
  maxUnits: 18,
  weightProfRating: 0.5,
  weightMinimizeGaps: 0.5,
};

describe('filterSections', () => {
  it('keeps all sections when nothing conflicts', () => {
    const course = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 675 }]),
      mkSection([{ days: ['Tu', 'Th'], startMin: 600, endMin: 675 }]),
    ]);
    const { viable, reasons } = filterSections(course, [], basePrefs);
    expect(viable).toHaveLength(2);
    expect(reasons.size).toBe(0);
  });

  it('drops sections hitting busy blocks and records reason', () => {
    const course = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M'], startMin: 600, endMin: 675 }]),
      mkSection([{ days: ['Tu'], startMin: 600, endMin: 675 }]),
    ]);
    const { viable, reasons } = filterSections(
      course,
      [{ day: 'M', startMin: 0, endMin: 1440 }],
      basePrefs,
    );
    expect(viable).toHaveLength(1);
    expect(viable[0].meetings[0].days).toEqual(['Tu']);
    expect(reasons.has('busy-block')).toBe(true);
  });

  it('drops sections on avoided days', () => {
    const course = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M', 'W', 'F'], startMin: 600, endMin: 650 }]),
      mkSection([{ days: ['Tu', 'Th'], startMin: 600, endMin: 675 }]),
    ]);
    const { viable, reasons } = filterSections(course, [], { ...basePrefs, avoidDays: ['F'] });
    expect(viable).toHaveLength(1);
    expect(reasons.has('avoid-day')).toBe(true);
  });

  it('drops sections outside the time window', () => {
    const course = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M'], startMin: 480, endMin: 555 }]), // 8am — too early
      mkSection([{ days: ['M'], startMin: 1140, endMin: 1215 }]), // ends 8:15pm — too late
      mkSection([{ days: ['M'], startMin: 660, endMin: 735 }]), // 11am — fine
    ]);
    const { viable, reasons } = filterSections(course, [], {
      ...basePrefs,
      earliestStart: 600,
      latestEnd: 1080,
    });
    expect(viable).toHaveLength(1);
    expect(viable[0].meetings[0].startMin).toBe(660);
    expect(reasons.has('time-window')).toBe(true);
  });

  it('async online sections survive every filter', () => {
    const course = mkCourse('CPSC 121', 3, [mkSection([])]);
    const { viable } = filterSections(
      course,
      [{ day: 'M', startMin: 0, endMin: 1440 }],
      { ...basePrefs, avoidDays: ['M', 'Tu', 'W', 'Th', 'F', 'Sa'], earliestStart: 600, latestEnd: 700 },
    );
    expect(viable).toHaveLength(1);
  });

  it('collects distinct reasons from different sections', () => {
    const course = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M'], startMin: 600, endMin: 675 }]),
      mkSection([{ days: ['F'], startMin: 600, endMin: 675 }]),
    ]);
    const { viable, reasons } = filterSections(
      course,
      [{ day: 'M', startMin: 0, endMin: 1440 }],
      { ...basePrefs, avoidDays: ['F'] },
    );
    expect(viable).toHaveLength(0);
    expect(reasons.has('busy-block')).toBe(true);
    expect(reasons.has('avoid-day')).toBe(true);
  });
});
