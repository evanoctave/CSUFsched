import { describe, it, expect } from 'vitest';
import {
  DAY_ORDER,
  GRID_START_MIN,
  GRID_END_MIN,
  snapMin,
  minToLabel,
  fmtRange,
  fmtDays,
  yToMin,
  dragToBusyBlock,
} from '../src/lib/time.ts';

describe('time utilities', () => {
  it('grid spans 7am to 10pm Mon-Sun', () => {
    expect(GRID_START_MIN).toBe(420);
    expect(GRID_END_MIN).toBe(1320);
    expect(DAY_ORDER).toEqual(['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su']);
  });

  it('snaps to 15-minute increments', () => {
    expect(snapMin(607)).toBe(600);
    expect(snapMin(608)).toBe(615);
    expect(snapMin(615)).toBe(615);
  });

  it('formats minutes as 12-hour labels', () => {
    expect(minToLabel(420)).toBe('7:00 AM');
    expect(minToLabel(600)).toBe('10:00 AM');
    expect(minToLabel(720)).toBe('12:00 PM');
    expect(minToLabel(795)).toBe('1:15 PM');
    expect(fmtRange(600, 675)).toBe('10:00 AM–11:15 AM');
    expect(fmtDays(['M', 'W', 'F'])).toBe('MWF');
  });

  it('converts grid y offsets (1px = 1min) to snapped, clamped minutes', () => {
    expect(yToMin(0)).toBe(420);
    expect(yToMin(187)).toBe(GRID_START_MIN + 180);
    expect(yToMin(-50)).toBe(420);
    expect(yToMin(5000)).toBe(1320);
  });

  it('dragToBusyBlock builds a block from any drag direction', () => {
    expect(dragToBusyBlock('Tu', 300, 180)).toEqual({ day: 'Tu', startMin: 600, endMin: 720 });
  });

  it('dragToBusyBlock rejects drags shorter than one snap unit', () => {
    expect(dragToBusyBlock('M', 100, 104)).toBeNull();
  });
});
