import type { RmpTeacher } from './types.ts';

export interface ParsedName {
  last: string;
  firstInitial: string;
}

export type MatchResult =
  | { status: 'matched'; teacher: RmpTeacher }
  | { status: 'ambiguous'; candidates: RmpTeacher[] }
  | { status: 'unmatched' };

export function parseCsufName(raw: string): ParsedName | null {
  const commaIdx = raw.indexOf(',');
  if (commaIdx <= 0) return null;
  const last = raw.slice(0, commaIdx).trim();
  const first = raw.slice(commaIdx + 1).trim();
  if (last === '' || first === '') return null;
  return { last, firstInitial: first[0].toUpperCase() };
}

export function matchProfessor(csufName: string, teachers: RmpTeacher[]): MatchResult {
  const parsed = parseCsufName(csufName);
  if (!parsed) return { status: 'unmatched' };
  const candidates = teachers.filter(
    (t) =>
      t.lastName.trim().toLowerCase() === parsed.last.toLowerCase() &&
      t.firstName.trim().charAt(0).toUpperCase() === parsed.firstInitial,
  );
  if (candidates.length === 1) return { status: 'matched', teacher: candidates[0] };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };
  return { status: 'unmatched' };
}
