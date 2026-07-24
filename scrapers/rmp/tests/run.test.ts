import { describe, it, expect, vi } from 'vitest';
import { updateProfessors } from '../src/run';
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
    tags: [{ tag: 'Clear lectures', count: 12 }],
    ...overrides,
  };
}

describe('updateProfessors', () => {
  const john = teacher({ rmpId: 'A', legacyId: 1 });
  const jane = teacher({ rmpId: 'B', legacyId: 2, firstName: 'Jane' });
  const ito = teacher({ rmpId: 'C', legacyId: 3, firstName: 'Kenji', lastName: 'Ito' });

  it('persists matched professors and reports counts', async () => {
    const persistMatch = vi.fn().mockResolvedValue(undefined);
    const summary = await updateProfessors({
      csufNames: ['Ito,K'],
      teachers: [john, jane, ito],
      persistMatch,
    });
    expect(persistMatch).toHaveBeenCalledWith('Ito,K', ito);
    expect(summary.matched).toBe(1);
    expect(summary.ambiguous).toEqual([]);
    expect(summary.unmatched).toEqual([]);
  });

  it('collects ambiguous names with candidate ids for the report file', async () => {
    const persistMatch = vi.fn();
    const summary = await updateProfessors({
      csufNames: ['Lee,J'],
      teachers: [john, jane, ito],
      persistMatch,
    });
    expect(persistMatch).not.toHaveBeenCalled();
    expect(summary.ambiguous).toEqual([
      { name: 'Lee,J', candidates: ['A', 'B'] },
    ]);
  });

  it('collects unmatched names', async () => {
    const persistMatch = vi.fn();
    const summary = await updateProfessors({
      csufNames: ['Nguyen,T', 'Staff'],
      teachers: [john, jane, ito],
      persistMatch,
    });
    expect(summary.unmatched).toEqual(['Nguyen,T', 'Staff']);
  });

  it('a persist failure is recorded and does not abort the run', async () => {
    const persistMatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);
    const summary = await updateProfessors({
      csufNames: ['Ito,K', 'Lee,Jane'],
      teachers: [ito, jane],
      persistMatch,
    });
    expect(summary.matched).toBe(1);
    expect(summary.errors).toEqual([{ name: 'Ito,K', error: 'db down' }]);
  });
});
