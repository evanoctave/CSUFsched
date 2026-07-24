import { describe, it, expect, beforeEach } from 'vitest';
import type { CourseWithSections } from '@csufsched/types';
import {
  useScheduleStore,
  DEFAULT_PREFS,
  STORE_DEFAULTS,
  placedSections,
  findSection,
} from '../src/store.ts';

const CPSC121: CourseWithSections = {
  id: 10,
  deptCode: 'CPSC',
  catalogNbr: '121',
  title: 'OOP',
  units: 3,
  sections: [
    {
      id: 1,
      courseId: 10,
      classNbr: '11111',
      sectionCode: '01',
      mode: 'in-person',
      enrollmentStatus: 'open',
      professor: null,
      meetings: [{ days: ['M', 'W'], startMin: 600, endMin: 675 }],
    },
    {
      id: 2,
      courseId: 10,
      classNbr: '22222',
      sectionCode: '02',
      mode: 'in-person',
      enrollmentStatus: 'open',
      professor: null,
      meetings: [{ days: ['Tu', 'Th'], startMin: 600, endMin: 675 }],
    },
  ],
};

const MATH150: CourseWithSections = {
  id: 20,
  deptCode: 'MATH',
  catalogNbr: '150B',
  title: 'Calc II',
  units: 4,
  sections: [
    {
      id: 5,
      courseId: 20,
      classNbr: '33333',
      sectionCode: '01',
      mode: 'in-person',
      enrollmentStatus: 'open',
      professor: null,
      meetings: [{ days: ['F'], startMin: 720, endMin: 840 }],
    },
  ],
};

describe('schedule store', () => {
  beforeEach(() => {
    localStorage.clear();
    useScheduleStore.setState(STORE_DEFAULTS);
  });

  it('placeSection stores the course and swaps same-course sections', () => {
    const s = useScheduleStore.getState();
    s.placeSection(CPSC121, 1);
    s.placeSection(MATH150, 5);
    s.placeSection(CPSC121, 2); // swap 1 -> 2
    const state = useScheduleStore.getState();
    expect(state.placedSectionIds).toEqual([5, 2]);
    expect(placedSections(state).map((p) => p.section.id)).toEqual([5, 2]);
  });

  it('busy blocks add and remove by index', () => {
    const s = useScheduleStore.getState();
    s.addBusyBlock({ day: 'Tu', startMin: 600, endMin: 720 });
    s.addBusyBlock({ day: 'F', startMin: 420, endMin: 480 });
    s.removeBusyBlock(0);
    expect(useScheduleStore.getState().busyBlocks).toEqual([
      { day: 'F', startMin: 420, endMin: 480 },
    ]);
  });

  it('setTerm to a new term resets schedule state', () => {
    const s = useScheduleStore.getState();
    s.setTerm(1, 'Fall 2026');
    s.placeSection(CPSC121, 1);
    s.addBusyBlock({ day: 'M', startMin: 600, endMin: 660 });
    s.setTerm(2, 'Spring 2027');
    const state = useScheduleStore.getState();
    expect(state.placedSectionIds).toEqual([]);
    expect(state.busyBlocks).toEqual([]);
    expect(state.termName).toBe('Spring 2027');
  });

  it('wanted courses toggle and prefs patch', () => {
    const s = useScheduleStore.getState();
    s.addWantedCourse(CPSC121);
    s.addWantedCourse(CPSC121); // no duplicate
    s.setPrefs({ avoidDays: ['F'] });
    const state = useScheduleStore.getState();
    expect(state.wantedCourseIds).toEqual([10]);
    expect(state.prefs).toEqual({ ...DEFAULT_PREFS, avoidDays: ['F'] });
    state.removeWantedCourse(10);
    expect(useScheduleStore.getState().wantedCourseIds).toEqual([]);
  });

  it('loadCandidate replaces placed sections for candidate courses only', () => {
    const s = useScheduleStore.getState();
    s.placeSection(CPSC121, 1);
    s.placeSection(MATH150, 5);
    s.loadCandidate([2]); // candidate covers CPSC only
    expect(useScheduleStore.getState().placedSectionIds).toEqual([5, 2]);
  });

  it('hydrateShared replaces the whole schedule', () => {
    const s = useScheduleStore.getState();
    s.placeSection(MATH150, 5);
    s.hydrateShared(1, 'Fall 2026', [CPSC121], [2], [{ day: 'M', startMin: 480, endMin: 540 }]);
    const state = useScheduleStore.getState();
    expect(state.termId).toBe(1);
    expect(state.placedSectionIds).toEqual([2]);
    expect(state.busyBlocks).toHaveLength(1);
    expect(findSection(state.catalog, 2)?.course.id).toBe(10);
  });
});
