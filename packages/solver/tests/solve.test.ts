import { describe, it, expect } from 'vitest';
import { solve } from '../src/solve';
import { mkCourse, mkSection, mkProf } from './helpers';
import type { SolverInput, SolverPrefs } from '@csufsched/types';

const basePrefs: SolverPrefs = {
  avoidDays: [],
  maxUnits: 18,
  weightProfRating: 0.5,
  weightMinimizeGaps: 0.5,
};

function input(partial: Partial<SolverInput>): SolverInput {
  return { courses: [], busyBlocks: [], lockedSectionIds: [], prefs: basePrefs, ...partial };
}

describe('solve', () => {
  it('returns ranked candidates for solvable input', () => {
    const cpsc = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 675 }], { professor: mkProf(4.5) }),
      mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 675 }], { professor: mkProf(2.0) }),
    ]);
    const math = mkCourse('MATH 150B', 4, [
      mkSection([{ days: ['Tu', 'Th'], startMin: 600, endMin: 715 }], { professor: mkProf(3.5) }),
    ]);
    const result = solve(input({ courses: [cpsc, math] }));

    expect(result.candidates).toHaveLength(2);
    expect(result.eliminations).toHaveLength(0);
    expect(result.totalValidCombos).toBe(2);
    // Higher-rated professor combo ranks first
    expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1].score);
    expect(result.candidates[0].explanation).toContain('★');
  });

  it('caps candidates at 5', () => {
    const sections = Array.from({ length: 7 }, () => mkSection([]));
    const course = mkCourse('CPSC 121', 3, sections);
    const result = solve(input({ courses: [course] }));
    expect(result.candidates).toHaveLength(5);
    expect(result.totalValidCombos).toBe(7);
  });

  it('reports which course was eliminated by a busy block', () => {
    const math = mkCourse('MATH 150B', 4, [
      mkSection([{ days: ['Tu'], startMin: 600, endMin: 715 }]),
      mkSection([{ days: ['Tu'], startMin: 720, endMin: 835 }]),
    ]);
    const result = solve(
      input({ courses: [math], busyBlocks: [{ day: 'Tu', startMin: 0, endMin: 1440 }] }),
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.eliminations).toHaveLength(1);
    expect(result.eliminations[0].courseLabel).toBe('MATH 150B');
    expect(result.eliminations[0].reasons).toContain('busy-block');
  });

  it('reports pairwise conflict when courses are individually fine but mutually exclusive', () => {
    const a = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M'], startMin: 600, endMin: 675 }]),
    ]);
    const b = mkCourse('CPSC 131', 3, [
      mkSection([{ days: ['M'], startMin: 620, endMin: 695 }]),
    ]);
    const result = solve(input({ courses: [a, b] }));
    expect(result.candidates).toHaveLength(0);
    expect(result.eliminations).toHaveLength(1);
    expect(result.eliminations[0].reasons).toEqual(['conflict']);
  });

  it('locked section is forced for its course', () => {
    const preferred = mkSection([{ days: ['M'], startMin: 600, endMin: 675 }], {
      professor: mkProf(5),
    });
    const locked = mkSection([{ days: ['Tu'], startMin: 600, endMin: 675 }], {
      professor: mkProf(1),
    });
    const course = mkCourse('CPSC 121', 3, [preferred, locked]);
    const result = solve(input({ courses: [course], lockedSectionIds: [locked.id] }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sectionIds).toEqual([locked.id]);
  });

  it('locked section bypasses filters (already accepted by user)', () => {
    const locked = mkSection([{ days: ['F'], startMin: 480, endMin: 555 }]);
    const course = mkCourse('CPSC 121', 3, [locked]);
    const result = solve(
      input({
        courses: [course],
        lockedSectionIds: [locked.id],
        prefs: { ...basePrefs, avoidDays: ['F'], earliestStart: 600 },
      }),
    );
    expect(result.candidates).toHaveLength(1);
  });
});
