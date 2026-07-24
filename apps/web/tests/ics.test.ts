import { describe, it, expect } from 'vitest';
import type { Course, Section } from '@csufsched/types';
import { buildIcs } from '../src/lib/ics.ts';

const course: Course = { id: 10, deptCode: 'CPSC', catalogNbr: '121', title: 'OOP', units: 3 };
const section: Section = {
  id: 1,
  courseId: 10,
  classNbr: '11111',
  sectionCode: '01',
  mode: 'in-person',
  enrollmentStatus: 'open',
  professor: null,
  meetings: [{ days: ['M', 'W'], startMin: 600, endMin: 675, building: 'CS', room: '101' }],
};

// Wed 2026-07-22 08:00 local
const FROM = new Date(2026, 6, 22, 8, 0, 0);

describe('buildIcs', () => {
  it('emits a weekly VEVENT per meeting anchored to the next occurrence', () => {
    const ics = buildIcs([{ course, section }], FROM);
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    // first day of the meeting is M; next Monday after Wed 7/22 is 7/27
    expect(ics).toContain('DTSTART:20260727T100000');
    expect(ics).toContain('DTEND:20260727T111500');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
    expect(ics).toContain('SUMMARY:CPSC 121 · Sec 01');
    expect(ics).toContain('LOCATION:CS 101');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('skips meetings with no days (async online)', () => {
    const online: Section = { ...section, id: 2, meetings: [] };
    const ics = buildIcs([{ course, section: online }], FROM);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('uses CRLF line endings', () => {
    expect(buildIcs([{ course, section }], FROM)).toContain('\r\n');
  });
});
