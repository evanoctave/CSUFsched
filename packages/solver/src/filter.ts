import type {
  CourseWithSections,
  EliminationReason,
  Section,
  SolverPrefs,
  TimeBlock,
} from '@csufsched/types';
import { sectionConflictsWithBlock } from './conflicts';

export interface FilterResult {
  viable: Section[];
  reasons: Set<EliminationReason>;
}

export function filterSections(
  course: CourseWithSections,
  busyBlocks: TimeBlock[],
  prefs: SolverPrefs,
): FilterResult {
  const reasons = new Set<EliminationReason>();
  const viable: Section[] = [];

  const { earliestStart, latestEnd } = prefs;

  // First matching reason wins per section; check order defines UI message priority.
  for (const s of course.sections) {
    if (busyBlocks.some((b) => sectionConflictsWithBlock(s, b))) {
      reasons.add('busy-block');
      continue;
    }
    if (s.meetings.some((m) => m.days.some((d) => prefs.avoidDays.includes(d)))) {
      reasons.add('avoid-day');
      continue;
    }
    if (earliestStart !== undefined && s.meetings.some((m) => m.startMin < earliestStart)) {
      reasons.add('time-window');
      continue;
    }
    if (latestEnd !== undefined && s.meetings.some((m) => m.endMin > latestEnd)) {
      reasons.add('time-window');
      continue;
    }
    viable.push(s);
  }

  return { viable, reasons };
}
