import { describe, it, expect } from 'vitest';
import type { Section } from '@csufsched/types';
import { dropConflicts } from '../src/lib/conflicts.ts';

function makeSection(id: number, courseId: number, days: Section['meetings'][number]['days'], startMin: number, endMin: number): Section {
  return {
    id,
    courseId,
    classNbr: String(10000 + id),
    sectionCode: '01',
    mode: 'in-person',
    enrollmentStatus: 'open',
    professor: null,
    meetings: [{ days, startMin, endMin }],
  };
}

describe('dropConflicts', () => {
  const incoming = makeSection(1, 10, ['M', 'W'], 600, 675);

  it('conflicts with an overlapping busy block', () => {
    expect(dropConflicts(incoming, [], [{ day: 'M', startMin: 660, endMin: 720 }])).toBe(true);
  });

  it('conflicts with an overlapping placed section of another course', () => {
    const placed = makeSection(9, 99, ['W'], 630, 700);
    expect(dropConflicts(incoming, [placed], [])).toBe(true);
  });

  it('ignores overlap with sections of the same course (swap case)', () => {
    const sameCourse = makeSection(2, 10, ['M', 'W'], 600, 675);
    expect(dropConflicts(incoming, [sameCourse], [])).toBe(false);
  });

  it('no conflict when times are clear', () => {
    const placed = makeSection(9, 99, ['Tu'], 600, 675);
    expect(dropConflicts(incoming, [placed], [{ day: 'F', startMin: 600, endMin: 700 }])).toBe(false);
  });
});
