import type {
  CourseWithSections,
  Day,
  Meeting,
  ProfessorSummary,
  Section,
} from '@csufsched/types';

export interface CourseQueryRow {
  id: number;
  dept_code: string;
  catalog_nbr: string;
  title: string;
  units: number;
}

export interface SectionQueryRow {
  id: number;
  course_id: number;
  class_nbr: string;
  section_code: string;
  mode: string;
  enrollment_status: string;
  professor_id: number | null;
  professor_full_name: string | null;
  professor_rating: number | null;
  professor_difficulty: number | null;
  professor_would_take_again_pct: number | null;
}

export interface MeetingQueryRow {
  section_id: number;
  days: string;
  start_min: number;
  end_min: number;
  building: string | null;
  room: string | null;
}

export interface TagQueryRow {
  professor_id: number;
  tag: string;
  count: number;
}

const TOP_TAG_LIMIT = 3;

function toProfessor(
  row: SectionQueryRow,
  tagsByProf: Map<number, TagQueryRow[]>,
): ProfessorSummary | null {
  if (row.professor_id === null || row.professor_full_name === null) return null;
  const topTags = (tagsByProf.get(row.professor_id) ?? [])
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_TAG_LIMIT)
    .map((t) => t.tag);
  return {
    id: row.professor_id,
    fullName: row.professor_full_name,
    rating: row.professor_rating,
    difficulty: row.professor_difficulty,
    wouldTakeAgainPct: row.professor_would_take_again_pct,
    topTags,
  };
}

function toMeeting(row: MeetingQueryRow): Meeting {
  return {
    days: row.days === '' ? [] : (row.days.split(',') as Day[]),
    startMin: row.start_min,
    endMin: row.end_min,
    building: row.building ?? undefined,
    room: row.room ?? undefined,
  };
}

export function assembleCourses(
  courseRows: CourseQueryRow[],
  sectionRows: SectionQueryRow[],
  meetingRows: MeetingQueryRow[],
  tagRows: TagQueryRow[],
): CourseWithSections[] {
  const tagsByProf = new Map<number, TagQueryRow[]>();
  for (const t of tagRows) {
    if (!tagsByProf.has(t.professor_id)) tagsByProf.set(t.professor_id, []);
    tagsByProf.get(t.professor_id)!.push(t);
  }

  const meetingsBySection = new Map<number, Meeting[]>();
  for (const m of meetingRows) {
    if (!meetingsBySection.has(m.section_id)) meetingsBySection.set(m.section_id, []);
    meetingsBySection.get(m.section_id)!.push(toMeeting(m));
  }

  const sectionsByCourse = new Map<number, Section[]>();
  for (const s of sectionRows) {
    const sec: Section = {
      id: s.id,
      courseId: s.course_id,
      classNbr: s.class_nbr,
      sectionCode: s.section_code,
      mode: s.mode as Section['mode'],
      enrollmentStatus: s.enrollment_status as Section['enrollmentStatus'],
      professor: toProfessor(s, tagsByProf),
      meetings: meetingsBySection.get(s.id) ?? [],
    };
    if (!sectionsByCourse.has(s.course_id)) sectionsByCourse.set(s.course_id, []);
    sectionsByCourse.get(s.course_id)!.push(sec);
  }

  return courseRows.map((c) => ({
    id: c.id,
    deptCode: c.dept_code,
    catalogNbr: c.catalog_nbr,
    title: c.title,
    units: c.units,
    sections: sectionsByCourse.get(c.id) ?? [],
  }));
}
