import { describe, it, expect } from 'vitest';
import { overlaps, meetingsConflict, meetingConflictsWithBlock } from '../src/time';
import type { Meeting, TimeBlock } from '@csufsched/types';

describe('overlaps', () => {
  it('detects overlapping intervals', () => {
    expect(overlaps(600, 675, 660, 720)).toBe(true);
  });

  it('returns false for touching intervals (end == start)', () => {
    expect(overlaps(600, 675, 675, 720)).toBe(false);
  });

  it('returns false for disjoint intervals', () => {
    expect(overlaps(600, 675, 720, 780)).toBe(false);
  });

  it('detects containment', () => {
    expect(overlaps(600, 720, 630, 660)).toBe(true);
  });

  it('returns false for zero-length intervals', () => {
    expect(overlaps(600, 600, 580, 600)).toBe(false);
  });

  it('detects identical intervals', () => {
    expect(overlaps(600, 650, 600, 650)).toBe(true);
  });
});

describe('meetingsConflict', () => {
  const mwf10: Meeting = { days: ['M', 'W', 'F'], startMin: 600, endMin: 650 };
  const tuth10: Meeting = { days: ['Tu', 'Th'], startMin: 600, endMin: 675 };
  const mw1015: Meeting = { days: ['M', 'W'], startMin: 615, endMin: 665 };
  const mwf12: Meeting = { days: ['M', 'W', 'F'], startMin: 720, endMin: 770 };

  it('conflicts when days shared and times overlap', () => {
    expect(meetingsConflict(mwf10, mw1015)).toBe(true);
  });

  it('no conflict when no shared days', () => {
    expect(meetingsConflict(mwf10, tuth10)).toBe(false);
  });

  it('no conflict when shared day but disjoint times', () => {
    expect(meetingsConflict(mwf10, mwf12)).toBe(false);
  });

  it('no conflict when one meeting ends exactly when the other starts', () => {
    const mwf1050: Meeting = { days: ['M', 'W', 'F'], startMin: 650, endMin: 700 };
    expect(meetingsConflict(mwf10, mwf1050)).toBe(false);
  });
});

describe('meetingConflictsWithBlock', () => {
  const mwf10: Meeting = { days: ['M', 'W', 'F'], startMin: 600, endMin: 650 };

  it('conflicts with busy block on same day and time', () => {
    const block: TimeBlock = { day: 'M', startMin: 630, endMin: 700 };
    expect(meetingConflictsWithBlock(mwf10, block)).toBe(true);
  });

  it('no conflict on different day', () => {
    const block: TimeBlock = { day: 'Tu', startMin: 600, endMin: 700 };
    expect(meetingConflictsWithBlock(mwf10, block)).toBe(false);
  });

  it('no conflict when block ends exactly at meeting start', () => {
    const block: TimeBlock = { day: 'M', startMin: 500, endMin: 600 };
    expect(meetingConflictsWithBlock(mwf10, block)).toBe(false);
  });
});
