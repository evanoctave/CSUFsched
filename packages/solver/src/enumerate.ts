import type { Section } from '@csufsched/types';
import { sectionsConflict } from './conflicts';

export const COMBO_CAP = 2000;

export interface EnumerateResult {
  combos: Section[][];
  truncated: boolean;
  /** Furthest course index reached with a consistent partial assignment. */
  deepestIndex: number;
}

export function enumerateCombos(sectionsByCourse: Section[][]): EnumerateResult {
  const combos: Section[][] = [];
  let truncated = false;
  let deepest = -1;
  const chosen: Section[] = [];

  function backtrack(i: number): void {
    if (i > deepest) deepest = i;
    if (i === sectionsByCourse.length) {
      combos.push([...chosen]);
      if (combos.length >= COMBO_CAP) truncated = true;
      return;
    }
    for (const s of sectionsByCourse[i]) {
      if (truncated) return;
      if (chosen.some((c) => sectionsConflict(c, s))) continue;
      chosen.push(s);
      backtrack(i + 1);
      chosen.pop();
    }
  }

  backtrack(0);
  return { combos, truncated, deepestIndex: deepest };
}
