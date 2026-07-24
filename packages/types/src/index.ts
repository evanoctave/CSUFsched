export type Day = 'M' | 'Tu' | 'W' | 'Th' | 'F' | 'Sa';

export interface Meeting {
  days: Day[];
  startMin: number; // minutes from midnight, e.g. 600 = 10:00am
  endMin: number;
  building?: string;
  room?: string;
}

export interface ProfessorSummary {
  id: number;
  fullName: string;
  rating: number | null; // 1–5, null = no RMP match
  difficulty: number | null;
  wouldTakeAgainPct: number | null;
  topTags: string[];
}

export interface Section {
  id: number;
  courseId: number;
  classNbr: string; // 5-digit CSUF class number
  sectionCode: string; // "01"
  mode: 'in-person' | 'online' | 'hybrid';
  enrollmentStatus: 'open' | 'closed' | 'waitlist';
  professor: ProfessorSummary | null;
  meetings: Meeting[]; // empty for async-online sections
}

export interface Course {
  id: number;
  deptCode: string; // "CPSC"
  catalogNbr: string; // "121"
  title: string;
  units: number;
}

export interface CourseWithSections extends Course {
  sections: Section[];
}

export interface TimeBlock {
  day: Day;
  startMin: number;
  endMin: number;
}

export interface SolverPrefs {
  avoidDays: Day[];
  earliestStart?: number; // minutes from midnight
  latestEnd?: number;
  maxUnits: number; // default 18; UI warns above but solver still runs
  weightProfRating: number; // 0–1
  weightMinimizeGaps: number; // 0–1
}

export interface SolverInput {
  courses: CourseWithSections[];
  busyBlocks: TimeBlock[];
  lockedSectionIds: number[]; // sections already on the grid; forced for their course
  prefs: SolverPrefs;
}

export interface ScheduleCandidate {
  sectionIds: number[];
  score: number;
  explanation: string; // "avg prof ★4.1 · 45 min gaps · 3 days on campus"
}

export type EliminationReason = 'busy-block' | 'avoid-day' | 'time-window' | 'conflict';

export interface CourseElimination {
  courseId: number;
  courseLabel: string; // "MATH 150B"
  reasons: EliminationReason[];
}

export interface SolverResult {
  candidates: ScheduleCandidate[]; // top 5 by score
  eliminations: CourseElimination[]; // non-empty exactly when candidates is empty
  totalValidCombos: number;
  truncated: boolean; // true if enumeration hit the combo cap
}
