export { mapTeacherNode } from './parse';
export { parseCsufName, matchProfessor } from './match';
export { updateProfessors, fetchAllTeachers } from './run';
export type { RawTeacherNode, RmpTeacher } from './types';
export type { ParsedName, MatchResult } from './match';
export type { UpdateSummary, UpdateProfessorsOptions } from './run';
