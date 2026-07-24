import type { Meeting, TimeBlock } from '@csufsched/types';

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function meetingsConflict(a: Meeting, b: Meeting): boolean {
  const sharedDay = a.days.some((d) => b.days.includes(d));
  return sharedDay && overlaps(a.startMin, a.endMin, b.startMin, b.endMin);
}

export function meetingConflictsWithBlock(m: Meeting, block: TimeBlock): boolean {
  return m.days.includes(block.day) && overlaps(m.startMin, m.endMin, block.startMin, block.endMin);
}
