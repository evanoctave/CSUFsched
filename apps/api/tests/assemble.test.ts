import { describe, it, expect } from 'vitest';
import { assembleCourses } from '../src/assemble';
import type {
  CourseQueryRow,
  SectionQueryRow,
  MeetingQueryRow,
  TagQueryRow,
} from '../src/assemble';

const course: CourseQueryRow = {
  id: 1,
  dept_code: 'CPSC',
  catalog_nbr: '121',
  title: 'Object-Oriented Programming',
  units: 3,
};

function section(overrides: Partial<SectionQueryRow>): SectionQueryRow {
  return {
    id: 10,
    course_id: 1,
    class_nbr: '12345',
    section_code: '01',
    mode: 'in-person',
    enrollment_status: 'open',
    professor_id: null,
    professor_full_name: null,
    professor_rating: null,
    professor_difficulty: null,
    professor_would_take_again_pct: null,
    ...overrides,
  };
}

describe('assembleCourses', () => {
  it('nests sections under courses and meetings under sections, splitting days', () => {
    const meetings: MeetingQueryRow[] = [
      { section_id: 10, days: 'M,W,F', start_min: 600, end_min: 650, building: 'CS', room: '101' },
    ];
    const result = assembleCourses([course], [section({})], meetings, []);
    expect(result).toHaveLength(1);
    expect(result[0].deptCode).toBe('CPSC');
    expect(result[0].sections).toHaveLength(1);
    const s = result[0].sections[0];
    expect(s.classNbr).toBe('12345');
    expect(s.meetings).toEqual([
      { days: ['M', 'W', 'F'], startMin: 600, endMin: 650, building: 'CS', room: '101' },
    ]);
  });

  it('maps a section with no instructor to professor: null and no meetings to []', () => {
    const result = assembleCourses([course], [section({})], [], []);
    expect(result[0].sections[0].professor).toBeNull();
    expect(result[0].sections[0].meetings).toEqual([]);
  });

  it('builds professor summary with top 3 tags by count descending', () => {
    const sec = section({
      professor_id: 7,
      professor_full_name: 'Lee,J',
      professor_rating: 4.2,
      professor_difficulty: 2.1,
      professor_would_take_again_pct: 78,
    });
    const tags: TagQueryRow[] = [
      { professor_id: 7, tag: 'clear lectures', count: 12 },
      { professor_id: 7, tag: 'lots of homework', count: 3 },
      { professor_id: 7, tag: 'caring', count: 8 },
      { professor_id: 7, tag: 'tough grader', count: 5 },
    ];
    const result = assembleCourses([course], [sec], [], tags);
    expect(result[0].sections[0].professor).toEqual({
      id: 7,
      fullName: 'Lee,J',
      rating: 4.2,
      difficulty: 2.1,
      wouldTakeAgainPct: 78,
      topTags: ['clear lectures', 'caring', 'tough grader'],
    });
  });

  it('omits building/room when null and keeps course order', () => {
    const course2: CourseQueryRow = { ...course, id: 2, catalog_nbr: '131', title: 'Data Structures' };
    const meetings: MeetingQueryRow[] = [
      { section_id: 10, days: 'Tu', start_min: 720, end_min: 795, building: null, room: null },
    ];
    const result = assembleCourses([course, course2], [section({})], meetings, []);
    expect(result.map((c) => c.catalogNbr)).toEqual(['121', '131']);
    expect(result[1].sections).toEqual([]);
    const m = result[0].sections[0].meetings[0];
    expect(m.building).toBeUndefined();
    expect(m.room).toBeUndefined();
  });
});
