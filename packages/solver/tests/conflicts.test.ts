import { describe, it, expect } from 'vitest';
import { sectionsConflict, sectionConflictsWithBlock } from '../src/conflicts';
import { mkSection } from './helpers';
import type { TimeBlock } from '@csufsched/types';

describe('sectionsConflict', () => {
  it('conflicts when any meetings overlap', () => {
    const lectureWithLab = mkSection([
      { days: ['M', 'W'], startMin: 600, endMin: 650 },
      { days: ['F'], startMin: 720, endMin: 830 }, // lab
    ]);
    const fridayClass = mkSection([{ days: ['F'], startMin: 780, endMin: 855 }]);
    expect(sectionsConflict(lectureWithLab, fridayClass)).toBe(true);
  });

  it('no conflict when all meetings disjoint', () => {
    const a = mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 650 }]);
    const b = mkSection([{ days: ['Tu', 'Th'], startMin: 600, endMin: 675 }]);
    expect(sectionsConflict(a, b)).toBe(false);
  });

  it('async online sections (no meetings) never conflict', () => {
    const online = mkSection([]);
    const a = mkSection([{ days: ['M'], startMin: 600, endMin: 650 }]);
    expect(sectionsConflict(online, a)).toBe(false);
  });

  it('detects conflict between later meetings across sections', () => {
    const a = mkSection([
      { days: ['M'], startMin: 600, endMin: 650 },
      { days: ['Th'], startMin: 900, endMin: 975 },
    ]);
    const b = mkSection([
      { days: ['Tu'], startMin: 600, endMin: 650 },
      { days: ['Th'], startMin: 930, endMin: 1005 },
    ]);
    expect(sectionsConflict(a, b)).toBe(true);
  });
});

describe('sectionConflictsWithBlock', () => {
  it('detects conflict with a busy block', () => {
    const s = mkSection([{ days: ['Tu', 'Th'], startMin: 780, endMin: 855 }]);
    const block: TimeBlock = { day: 'Tu', startMin: 800, endMin: 900 };
    expect(sectionConflictsWithBlock(s, block)).toBe(true);
  });

  it('no conflict when block is on a free day', () => {
    const s = mkSection([{ days: ['Tu', 'Th'], startMin: 780, endMin: 855 }]);
    const block: TimeBlock = { day: 'W', startMin: 0, endMin: 1440 };
    expect(sectionConflictsWithBlock(s, block)).toBe(false);
  });
});
