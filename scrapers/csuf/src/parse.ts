import type { Day } from '@csufsched/types';

const DAY_MAP: Record<string, Day> = {
  Mo: 'M',
  Tu: 'Tu',
  We: 'W',
  Th: 'Th',
  Fr: 'F',
  Sa: 'Sa',
  Su: 'Su',
};

export function parseDays(raw: string): Day[] {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'TBA') return [];
  const days: Day[] = [];
  for (let i = 0; i < trimmed.length; i += 2) {
    const token = trimmed.slice(i, i + 2);
    const day = DAY_MAP[token];
    if (!day) throw new Error(`unrecognized day token "${token}" in "${raw}"`);
    days.push(day);
  }
  return days;
}

export function parseTime(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'TBA') return null;
  const m = /^(\d{1,2}):(\d{2})(AM|PM)$/.exec(trimmed);
  if (!m) throw new Error(`invalid time "${raw}"`);
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 1 || hours > 12 || minutes > 59) throw new Error(`invalid time "${raw}"`);
  if (m[3] === 'AM' && hours === 12) hours = 0;
  if (m[3] === 'PM' && hours !== 12) hours += 12;
  return hours * 60 + minutes;
}
