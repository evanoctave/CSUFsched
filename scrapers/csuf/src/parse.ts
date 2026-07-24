import type { Day } from '@csufsched/types';
import type { RawClassRow, ScrapedCourse, ScrapedSection } from './types.ts';

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
  if (trimmed.length % 2 !== 0) throw new Error(`unrecognized day string "${raw}" (odd length)`);
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

const MODE_MAP: Record<string, ScrapedSection['mode']> = {
  P: 'in-person',
  OL: 'online',
  HY: 'hybrid',
};

const STATUS_MAP: Record<string, ScrapedSection['enrollmentStatus']> = {
  O: 'open',
  C: 'closed',
  W: 'waitlist',
};

export interface ParseResult {
  courses: ScrapedCourse[];
  skipped: Array<{ row: RawClassRow; error: string }>;
}

export function parseClassRows(rows: RawClassRow[]): ParseResult {
  const courses = new Map<string, ScrapedCourse>();
  const sections = new Map<string, ScrapedSection>();
  const skipped: ParseResult['skipped'] = [];

  for (const row of rows) {
    try {
      // Parse fallible fields BEFORE registering anything, so a bad row
      // leaves no partial course/section behind.
      const days = parseDays(row.meeting_days);
      const startMin = parseTime(row.start_time);
      const endMin = parseTime(row.end_time);
      const units = parseUnits(row.units);
      const mode = MODE_MAP[row.instruction_mode];
      if (!mode) throw new Error(`unknown instruction_mode "${row.instruction_mode}"`);
      const status = STATUS_MAP[row.enrollment_status];
      if (!status) throw new Error(`unknown enrollment_status "${row.enrollment_status}"`);

      const courseKey = `${row.subject} ${row.catalog_nbr}`;
      let course = courses.get(courseKey);
      if (!course) {
        course = {
          deptCode: row.subject,
          catalogNbr: row.catalog_nbr,
          title: row.descr,
          units,
          sections: [],
        };
        courses.set(courseKey, course);
      }

      const sectionKey = `${courseKey}#${row.class_nbr}`;
      let section = sections.get(sectionKey);
      if (!section) {
        const instructor = row.instructor.trim();
        section = {
          classNbr: row.class_nbr,
          sectionCode: row.class_section,
          instructorName: instructor === '' || instructor === 'Staff' ? null : instructor,
          mode,
          enrollmentStatus: status,
          meetings: [],
        };
        sections.set(sectionKey, section);
        course.sections.push(section);
      }

      if (days.length > 0 && startMin !== null && endMin !== null) {
        section.meetings.push({
          days,
          startMin,
          endMin,
          building: row.building.trim() === '' ? null : row.building.trim(),
          room: row.room.trim() === '' ? null : row.room.trim(),
        });
      }
    } catch (err) {
      skipped.push({ row, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // A course whose every row failed was never registered (or registered with
  // zero sections) — drop empty shells.
  const kept = [...courses.values()].filter((c) => c.sections.length > 0);
  return { courses: kept, skipped };
}

function parseUnits(raw: string): number {
  const first = raw.split('-')[0].trim();
  const units = Number(first);
  if (Number.isNaN(units)) throw new Error(`invalid units "${raw}"`);
  return units;
}
