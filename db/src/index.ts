export { createPool } from './pool';
export { orderMigrations, runMigrations } from './migrate';
export {
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  replaceMeetings,
  upsertProfessor,
  replaceProfTags,
} from './upserts';
export type {
  TermRow,
  DepartmentRow,
  CourseRow,
  SectionRow,
  MeetingRow,
  ProfessorRow,
} from './upserts';
