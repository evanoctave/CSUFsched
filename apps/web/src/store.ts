import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CourseWithSections, Section, SolverPrefs, TimeBlock } from '@csufsched/types';

export const DEFAULT_PREFS: SolverPrefs = {
  avoidDays: [],
  maxUnits: 18,
  weightProfRating: 0.5,
  weightMinimizeGaps: 0.5,
};

interface ScheduleData {
  termId: number | null;
  termName: string | null;
  busyBlocks: TimeBlock[];
  placedSectionIds: number[];
  wantedCourseIds: number[];
  catalog: Record<number, CourseWithSections>;
  prefs: SolverPrefs;
  apiStale: boolean;
}

export interface ScheduleState extends ScheduleData {
  setTerm: (id: number, name: string) => void;
  addBusyBlock: (block: TimeBlock) => void;
  removeBusyBlock: (index: number) => void;
  placeSection: (course: CourseWithSections, sectionId: number) => void;
  removeSection: (sectionId: number) => void;
  addWantedCourse: (course: CourseWithSections) => void;
  removeWantedCourse: (courseId: number) => void;
  setPrefs: (patch: Partial<SolverPrefs>) => void;
  loadCandidate: (sectionIds: number[]) => void;
  setApiStale: (stale: boolean) => void;
  hydrateShared: (
    termId: number,
    termName: string,
    courses: CourseWithSections[],
    sectionIds: number[],
    busyBlocks: TimeBlock[],
  ) => void;
}

export const STORE_DEFAULTS: ScheduleData = {
  termId: null,
  termName: null,
  busyBlocks: [],
  placedSectionIds: [],
  wantedCourseIds: [],
  catalog: {},
  prefs: DEFAULT_PREFS,
  apiStale: false,
};

export function findSection(
  catalog: Record<number, CourseWithSections>,
  sectionId: number,
): { course: CourseWithSections; section: Section } | null {
  for (const course of Object.values(catalog)) {
    const section = course.sections.find((s) => s.id === sectionId);
    if (section) return { course, section };
  }
  return null;
}

export function placedSections(
  state: Pick<ScheduleState, 'catalog' | 'placedSectionIds'>,
): Array<{ course: CourseWithSections; section: Section }> {
  return state.placedSectionIds
    .map((id) => findSection(state.catalog, id))
    .filter((x): x is { course: CourseWithSections; section: Section } => x !== null);
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set) => ({
      ...STORE_DEFAULTS,

      setTerm: (id, name) =>
        set((state) =>
          state.termId === id
            ? { termName: name }
            : { ...STORE_DEFAULTS, termId: id, termName: name, apiStale: state.apiStale },
        ),

      addBusyBlock: (block) => set((state) => ({ busyBlocks: [...state.busyBlocks, block] })),

      removeBusyBlock: (index) =>
        set((state) => ({ busyBlocks: state.busyBlocks.filter((_, i) => i !== index) })),

      placeSection: (course, sectionId) =>
        set((state) => ({
          catalog: { ...state.catalog, [course.id]: course },
          placedSectionIds: [
            ...state.placedSectionIds.filter((id) => !course.sections.some((s) => s.id === id)),
            sectionId,
          ],
        })),

      removeSection: (sectionId) =>
        set((state) => ({
          placedSectionIds: state.placedSectionIds.filter((id) => id !== sectionId),
        })),

      addWantedCourse: (course) =>
        set((state) => ({
          catalog: { ...state.catalog, [course.id]: course },
          wantedCourseIds: state.wantedCourseIds.includes(course.id)
            ? state.wantedCourseIds
            : [...state.wantedCourseIds, course.id],
        })),

      removeWantedCourse: (courseId) =>
        set((state) => ({
          wantedCourseIds: state.wantedCourseIds.filter((id) => id !== courseId),
        })),

      setPrefs: (patch) => set((state) => ({ prefs: { ...state.prefs, ...patch } })),

      loadCandidate: (sectionIds) =>
        set((state) => {
          const courseIds = new Set(
            sectionIds
              .map((id) => findSection(state.catalog, id)?.course.id)
              .filter((x): x is number => x !== undefined),
          );
          return {
            placedSectionIds: [
              ...state.placedSectionIds.filter((id) => {
                const hit = findSection(state.catalog, id);
                return hit !== null && !courseIds.has(hit.course.id);
              }),
              ...sectionIds,
            ],
          };
        }),

      setApiStale: (stale) => set({ apiStale: stale }),

      hydrateShared: (termId, termName, courses, sectionIds, busyBlocks) =>
        set(() => ({
          ...STORE_DEFAULTS,
          termId,
          termName,
          catalog: Object.fromEntries(courses.map((c) => [c.id, c])),
          placedSectionIds: sectionIds,
          busyBlocks,
        })),
    }),
    {
      name: 'csufsched:v1',
      partialize: (s) => ({
        termId: s.termId,
        termName: s.termName,
        busyBlocks: s.busyBlocks,
        placedSectionIds: s.placedSectionIds,
        wantedCourseIds: s.wantedCourseIds,
        catalog: s.catalog,
        prefs: s.prefs,
      }),
    },
  ),
);
