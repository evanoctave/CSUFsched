import type { Section, TimeBlock } from '@csufsched/types';
import { meetingsConflict, meetingConflictsWithBlock } from './time';

export function sectionsConflict(a: Section, b: Section): boolean {
  return a.meetings.some((ma) => b.meetings.some((mb) => meetingsConflict(ma, mb)));
}

export function sectionConflictsWithBlock(s: Section, block: TimeBlock): boolean {
  return s.meetings.some((m) => meetingConflictsWithBlock(m, block));
}
