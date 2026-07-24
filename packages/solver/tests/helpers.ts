import type {
  CourseWithSections,
  Meeting,
  ProfessorSummary,
  Section,
} from '@csufsched/types';

let nextId = 1;

export function mkProf(rating: number | null, fullName = 'Test Prof'): ProfessorSummary {
  return {
    id: nextId++,
    fullName,
    rating,
    difficulty: null,
    wouldTakeAgainPct: null,
    topTags: [],
  };
}

export function mkSection(
  meetings: Meeting[],
  opts: { id?: number; courseId?: number; professor?: ProfessorSummary | null } = {},
): Section {
  return {
    id: opts.id ?? nextId++,
    courseId: opts.courseId ?? 0,
    classNbr: '10000',
    sectionCode: '01',
    mode: 'in-person',
    enrollmentStatus: 'open',
    professor: opts.professor ?? null,
    meetings,
  };
}

export function mkCourse(
  label: string, // "CPSC 121"
  units: number,
  sections: Section[],
): CourseWithSections {
  const [deptCode, catalogNbr] = label.split(' ');
  const id = nextId++;
  return {
    id,
    deptCode,
    catalogNbr,
    title: label,
    units,
    sections: sections.map((s) => ({ ...s, courseId: id })),
  };
}
