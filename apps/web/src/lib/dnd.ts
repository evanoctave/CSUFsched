import type { Section, TimeBlock } from '@csufsched/types';
import { dropConflicts } from './conflicts.ts';

export type DropDecision = 'place' | 'reject' | 'ignore';

export function resolveDrop(
  section: Section,
  overId: string | null,
  placed: Section[],
  busyBlocks: TimeBlock[],
): DropDecision {
  if (overId !== 'calendar') return 'ignore';
  return dropConflicts(section, placed, busyBlocks) ? 'reject' : 'place';
}
