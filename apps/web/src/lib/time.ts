import type { Day, TimeBlock } from '@csufsched/types';

export const DAY_ORDER: Day[] = ['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'];
export const DAY_LABELS: Record<Day, string> = {
  M: 'Mon',
  Tu: 'Tue',
  W: 'Wed',
  Th: 'Thu',
  F: 'Fri',
  Sa: 'Sat',
  Su: 'Sun',
};
export const GRID_START_MIN = 420; // 7:00 AM
export const GRID_END_MIN = 1320; // 10:00 PM; grid is rendered 1px per minute
export const SNAP_MIN = 15;

export function snapMin(min: number): number {
  return Math.round(min / SNAP_MIN) * SNAP_MIN;
}

export function minToLabel(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function fmtRange(startMin: number, endMin: number): string {
  return `${minToLabel(startMin)}–${minToLabel(endMin)}`;
}

export function fmtDays(days: Day[]): string {
  return days.join('');
}

export function yToMin(y: number): number {
  const snapped = snapMin(GRID_START_MIN + y);
  return Math.min(GRID_END_MIN, Math.max(GRID_START_MIN, snapped));
}

export function dragToBusyBlock(day: Day, y1: number, y2: number): TimeBlock | null {
  const startMin = yToMin(Math.min(y1, y2));
  const endMin = yToMin(Math.max(y1, y2));
  return endMin - startMin >= SNAP_MIN ? { day, startMin, endMin } : null;
}
