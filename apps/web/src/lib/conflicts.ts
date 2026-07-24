import { sectionsConflict, sectionConflictsWithBlock } from '@csufsched/solver';
import type { Section, TimeBlock } from '@csufsched/types';

export function dropConflicts(
  section: Section,
  placed: Section[],
  busyBlocks: TimeBlock[],
): boolean {
  return (
    busyBlocks.some((b) => sectionConflictsWithBlock(section, b)) ||
    placed.some((p) => p.courseId !== section.courseId && sectionsConflict(section, p))
  );
}
