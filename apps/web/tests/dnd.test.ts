import { describe, it, expect } from 'vitest';
import type { Section } from '@csufsched/types';
import { resolveDrop } from '../src/lib/dnd.ts';

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

const incoming = makeSection(1, 10, ['M', 'W'], 600, 675);

describe('resolveDrop', () => {
  it('ignores drops outside the calendar', () => {
    expect(resolveDrop(incoming, null, [], [])).toBe('ignore');
    expect(resolveDrop(incoming, 'sidebar', [], [])).toBe('ignore');
  });

  it('places when no conflict', () => {
    expect(resolveDrop(incoming, 'calendar', [], [])).toBe('place');
  });

  it('rejects on busy-block conflict', () => {
    expect(
      resolveDrop(incoming, 'calendar', [], [{ day: 'W', startMin: 660, endMin: 720 }]),
    ).toBe('reject');
  });

  it('places when only same-course sections overlap (swap)', () => {
    const sameCourse = makeSection(2, 10, ['M', 'W'], 600, 675);
    expect(resolveDrop(incoming, 'calendar', [sameCourse], [])).toBe('place');
  });
});
