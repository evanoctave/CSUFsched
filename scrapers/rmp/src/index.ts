export { mapTeacherNode } from './parse.ts';
export { parseCsufName, matchProfessor } from './match.ts';
export { updateProfessors, fetchAllTeachers } from './run.ts';
export type { RawTeacherNode, RmpTeacher } from './types.ts';
export type { ParsedName, MatchResult } from './match.ts';
export type { UpdateSummary, UpdateProfessorsOptions } from './run.ts';
