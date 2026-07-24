import { describe, it, expect } from 'vitest';
import { parseCsufName, matchProfessor } from '../src/match';
import type { RmpTeacher } from '../src/types';

function teacher(overrides: Partial<RmpTeacher>): RmpTeacher {
  return {
    rmpId: 'X',
    legacyId: 0,
    firstName: 'John',
    lastName: 'Lee',
    rating: 4,
    difficulty: 2,
    wouldTakeAgainPct: 80,
    numRatings: 10,
    rmpUrl: 'https://www.ratemyprofessors.com/professor/0',
    tags: [],
    ...overrides,
  };
}

describe('parseCsufName', () => {
  it('parses Last,FirstInitial', () => {
    expect(parseCsufName('Lee,J')).toEqual({ last: 'Lee', firstInitial: 'J' });
  });

  it('parses Last,First full name', () => {
    expect(parseCsufName('Lee,John')).toEqual({ last: 'Lee', firstInitial: 'J' });
  });

  it('handles multi-part last names and trims spaces', () => {
    expect(parseCsufName('Van Der Berg, K')).toEqual({ last: 'Van Der Berg', firstInitial: 'K' });
  });

  it('returns null for names without a comma', () => {
    expect(parseCsufName('Staff')).toBeNull();
    expect(parseCsufName('')).toBeNull();
  });
});

describe('matchProfessor', () => {
  const john = teacher({ rmpId: 'A', firstName: 'John', lastName: 'Lee' });
  const jane = teacher({ rmpId: 'B', firstName: 'Jane', lastName: 'Lee' });
  const ito = teacher({ rmpId: 'C', firstName: 'Kenji', lastName: 'Ito' });

  it('matches unique last name + first initial', () => {
    const result = matchProfessor('Ito,K', [john, jane, ito]);
    expect(result).toEqual({ status: 'matched', teacher: ito });
  });

  it('is case-insensitive', () => {
    const result = matchProfessor('ITO,k', [john, jane, ito]);
    expect(result).toEqual({ status: 'matched', teacher: ito });
  });

  it('reports ambiguity when multiple teachers share last name + initial', () => {
    const jack = teacher({ rmpId: 'D', firstName: 'Jack', lastName: 'Lee' });
    const result = matchProfessor('Lee,J', [john, jane, jack, ito]);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates.map((c) => c.rmpId).sort()).toEqual(['A', 'B', 'D']);
    }
  });

  it('distinguishes same last name by initial', () => {
    const result = matchProfessor('Lee,Jane', [john, jane, ito]);
    // Both John and Jane have initial J — ambiguous by the spec rule (initial only)
    expect(result.status).toBe('ambiguous');
  });

  it('returns unmatched when nothing fits', () => {
    expect(matchProfessor('Nguyen,T', [john, jane, ito])).toEqual({ status: 'unmatched' });
    expect(matchProfessor('Staff', [john, jane, ito])).toEqual({ status: 'unmatched' });
  });
});
