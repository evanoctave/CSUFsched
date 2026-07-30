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
  countSectionsForTerm,
  deleteSectionsNotIn,
  deleteCoursesNotIn,
  updateSectionStatuses,
} from './upserts.ts';
export type {
  TermRow,
  DepartmentRow,
  CourseRow,
  SectionRow,
  MeetingRow,
  ProfessorRow,
  Queryable,
} from './upserts.ts';
