import type {
  CourseElimination,
  EliminationReason,
  ScheduleCandidate,
  Section,
  SolverInput,
  SolverResult,
} from '@csufsched/types';
import { filterSections } from './filter';
import { enumerateCombos } from './enumerate';
import { avgProfRating, daysOnCampus, scoreCombo, totalGapMinutes } from './score';

export const TOP_N = 5;

export function solve(input: SolverInput): SolverResult {
  const { courses, busyBlocks, lockedSectionIds, prefs } = input;
  const locked = new Set(lockedSectionIds);

  const filtered = courses.map((course) => {
    // If multiple locked ids target one course, first match wins.
    const lockedSection = course.sections.find((s) => locked.has(s.id));
    if (lockedSection) {
      return { course, viable: [lockedSection], reasons: new Set<EliminationReason>() };
    }
    const { viable, reasons } = filterSections(course, busyBlocks, prefs);
    return { course, viable, reasons };
  });

  const eliminations: CourseElimination[] = filtered
    .filter((f) => f.viable.length === 0)
    .map((f) => ({
      courseId: f.course.id,
      courseLabel: `${f.course.deptCode} ${f.course.catalogNbr}`,
      reasons: [...f.reasons],
    }));

  if (eliminations.length > 0) {
    return { candidates: [], eliminations, totalValidCombos: 0, truncated: false };
  }

  // Fewest-sections-first prunes the search tree fastest.
  const ordered = [...filtered].sort((a, b) => a.viable.length - b.viable.length);
  const { combos, truncated, deepestIndex } = enumerateCombos(ordered.map((f) => f.viable));

  if (combos.length === 0) {
    // deepestIndex >= 0 here: ordered and all viable lists are non-empty, so backtracking visits index 0.
    const blocked = ordered[Math.min(deepestIndex, ordered.length - 1)];
    return {
      candidates: [],
      eliminations: [
        {
          courseId: blocked.course.id,
          courseLabel: `${blocked.course.deptCode} ${blocked.course.catalogNbr}`,
          reasons: ['conflict'],
        },
      ],
      totalValidCombos: 0,
      truncated,
    };
  }

  const candidates: ScheduleCandidate[] = combos
    .map((combo) => ({
      sectionIds: combo.map((s) => s.id),
      score: scoreCombo(combo, prefs),
      explanation: explain(combo),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  return { candidates, eliminations: [], totalValidCombos: combos.length, truncated };
}

function explain(combo: Section[]): string {
  const rating = avgProfRating(combo).toFixed(1);
  const gaps = totalGapMinutes(combo);
  const days = daysOnCampus(combo);
  return `avg prof ★${rating} · ${gaps} min gaps · ${days} day${days === 1 ? '' : 's'} on campus`;
}
