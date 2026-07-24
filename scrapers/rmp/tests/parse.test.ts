import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapTeacherNode } from '../src/parse';
import type { RawTeacherNode } from '../src/types';

const fixture: RawTeacherNode[] = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'teachers.json'),
    'utf8',
  ),
);

describe('mapTeacherNode', () => {
  it('maps a full teacher node with sorted top tags', () => {
    const t = mapTeacherNode(fixture[0]);
    expect(t).toEqual({
      rmpId: 'VGVhY2hlci0x',
      legacyId: 1,
      firstName: 'John',
      lastName: 'Lee',
      rating: 4.2,
      difficulty: 2.1,
      wouldTakeAgainPct: 78,
      numRatings: 55,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/1',
      tags: [
        { tag: 'Clear lectures', count: 12 },
        { tag: 'Low homework', count: 9 },
        { tag: 'Caring', count: 3 },
      ],
    });
  });

  it('normalizes wouldTakeAgainPercent -1 to null', () => {
    expect(mapTeacherNode(fixture[1]).wouldTakeAgainPct).toBeNull();
  });

  it('keeps null rating for unrated teachers', () => {
    const t = mapTeacherNode(fixture[2]);
    expect(t.rating).toBeNull();
    expect(t.difficulty).toBeNull();
    expect(t.numRatings).toBe(0);
  });
});
