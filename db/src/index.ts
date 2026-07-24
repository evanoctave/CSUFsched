export { createPool } from './pool.ts';
export { orderMigrations, runMigrations } from './migrate.ts';
export {
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  replaceMeetings,
  upsertProfessor,
  replaceProfTags,
} from './upserts.ts';
export type {
  TermRow,
  DepartmentRow,
  CourseRow,
  SectionRow,
  MeetingRow,
  ProfessorRow,
} from './upserts.ts';
