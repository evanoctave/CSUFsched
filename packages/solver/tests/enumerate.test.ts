import { describe, it, expect } from 'vitest';
import { enumerateCombos, COMBO_CAP } from '../src/enumerate';
import { mkSection } from './helpers';
import type { Meeting, Section } from '@csufsched/types';

function at(days: Meeting['days'], startMin: number, endMin: number): Section {
  return mkSection([{ days, startMin, endMin }]);
}

describe('enumerateCombos', () => {
  it('returns the cartesian product when nothing conflicts', () => {
    const courseA = [at(['M'], 600, 650), at(['M'], 720, 770)];
    const courseB = [at(['Tu'], 600, 675), at(['Th'], 600, 675)];
    const { combos, truncated } = enumerateCombos([courseA, courseB]);
    expect(combos).toHaveLength(4);
    expect(truncated).toBe(false);
  });

  it('excludes conflicting combinations', () => {
    const clash1 = at(['M'], 600, 650);
    const clash2 = at(['M'], 620, 670);
    const free = at(['Tu'], 600, 675);
    const { combos } = enumerateCombos([[clash1], [clash2, free]]);
    expect(combos).toHaveLength(1);
    expect(combos[0][1].id).toBe(free.id);
  });

  it('returns empty when every combination conflicts', () => {
    const a = at(['M'], 600, 650);
    const b = at(['M'], 600, 650);
    const { combos, deepestIndex } = enumerateCombos([[a], [b]]);
    expect(combos).toHaveLength(0);
    expect(deepestIndex).toBe(1); // reached course index 1, could not extend
  });

  it('truncates at COMBO_CAP', () => {
    // 8 courses x 3 async-online sections = 6561 combos > cap
    const courses = Array.from({ length: 8 }, () => [
      mkSection([]),
      mkSection([]),
      mkSection([]),
    ]);
    const { combos, truncated } = enumerateCombos(courses);
    expect(truncated).toBe(true);
    expect(combos).toHaveLength(COMBO_CAP);
  });

  it('handles a single course', () => {
    const { combos } = enumerateCombos([[at(['M'], 600, 650)]]);
    expect(combos).toHaveLength(1);
  });
});
