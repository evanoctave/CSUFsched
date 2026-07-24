import type { Course, Day, Section } from '@csufsched/types';

const ICS_DAY: Record<Day, string> = {
  M: 'MO',
  Tu: 'TU',
  W: 'WE',
  Th: 'TH',
  F: 'FR',
  Sa: 'SA',
  Su: 'SU',
};
const JS_DAY: Record<Day, number> = { Su: 0, M: 1, Tu: 2, W: 3, Th: 4, F: 5, Sa: 6 };

function nextOccurrence(day: Day, startMin: number, from: Date): Date {
  const d = new Date(from);
  d.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
  const delta = (JS_DAY[day] - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  if (d < from) d.setDate(d.getDate() + 7);
  return d;
}

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

export function buildIcs(
  entries: Array<{ course: Course; section: Section }>,
  from: Date = new Date(),
): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//csufsched//EN'];
  for (const { course, section } of entries) {
    section.meetings.forEach((m, i) => {
      if (m.days.length === 0) return;
      const start = nextOccurrence(m.days[0], m.startMin, from);
      const end = new Date(start.getTime() + (m.endMin - m.startMin) * 60_000);
      lines.push(
        'BEGIN:VEVENT',
        `UID:csufsched-${section.id}-${i}`,
        `SUMMARY:${course.deptCode} ${course.catalogNbr} · Sec ${section.sectionCode}`,
        `DTSTART:${fmtLocal(start)}`,
        `DTEND:${fmtLocal(end)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${m.days.map((d) => ICS_DAY[d]).join(',')}`,
      );
      if (m.building !== undefined) {
        lines.push(`LOCATION:${m.building}${m.room !== undefined ? ` ${m.room}` : ''}`);
      }
      lines.push('END:VEVENT');
    });
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
