import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import type { CourseWithSections, DepartmentSummary, ProfessorDetail } from '@csufsched/types';
import { CourseSearch } from '../src/components/CourseSearch.tsx';
import { useScheduleStore, STORE_DEFAULTS } from '../src/store.ts';

const DEPTS: DepartmentSummary[] = [{ id: 1, code: 'CPSC', name: 'Computer Science' }];
const PROF_DETAIL: ProfessorDetail = {
  id: 7,
  fullName: 'Lee,J',
  rating: 4.2,
  difficulty: 2.1,
  wouldTakeAgainPct: 78,
  numRatings: 55,
  rmpUrl: null,
  tags: [{ tag: 'clear lectures', count: 12 }],
};
const COURSES: CourseWithSections[] = [
  {
    id: 10,
    deptCode: 'CPSC',
    catalogNbr: '121',
    title: 'Object-Oriented Programming',
    units: 3,
    sections: [
      {
        id: 1,
        courseId: 10,
        classNbr: '11111',
        sectionCode: '01',
        mode: 'in-person',
        enrollmentStatus: 'open',
        professor: {
          id: 7,
          fullName: 'Lee,J',
          rating: 4.2,
          difficulty: 2.1,
          wouldTakeAgainPct: 78,
          topTags: ['clear lectures', 'caring', 'tough grader'],
        },
        meetings: [{ days: ['M', 'W'], startMin: 600, endMin: 675 }],
      },
    ],
  },
  {
    id: 11,
    deptCode: 'CPSC',
    catalogNbr: '131',
    title: 'Data Structures',
    units: 3,
    sections: [],
  },
];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/departments')) return jsonResponse(DEPTS);
      if (u.includes('/courses')) return jsonResponse(COURSES);
      if (u.includes('/professors/')) return jsonResponse(PROF_DETAIL);
      throw new Error(`unexpected fetch ${u}`);
    }),
  );
}

async function setup() {
  useScheduleStore.setState({ ...STORE_DEFAULTS, termId: 1, termName: 'Fall 2026' });
  render(
    <DndContext>
      <CourseSearch />
    </DndContext>,
  );
  await screen.findByRole('option', { name: /CPSC — Computer Science/ });
  await userEvent.selectOptions(screen.getByLabelText('Department'), 'CPSC');
  await screen.findByText('Object-Oriented Programming');
}

describe('CourseSearch', () => {
  beforeEach(() => {
    localStorage.clear();
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads departments and courses, expands sections', async () => {
    await setup();
    await userEvent.click(screen.getByRole('button', { name: /CPSC 121/ }));
    expect(screen.getByText('Sec 01')).toBeInTheDocument();
    expect(screen.getByText('MW 10:00 AM–11:15 AM')).toBeInTheDocument();
    expect(screen.getByText(/Lee,J ★4\.2/)).toBeInTheDocument();
    // top 2 tags only
    expect(screen.getByText('clear lectures')).toBeInTheDocument();
    expect(screen.getByText('caring')).toBeInTheDocument();
    expect(screen.queryByText('tough grader')).not.toBeInTheDocument();
  });

  it('filters by search text client-side', async () => {
    await setup();
    await userEvent.type(screen.getByPlaceholderText('Search courses'), '131');
    expect(screen.queryByText('Object-Oriented Programming')).not.toBeInTheDocument();
    expect(screen.getByText('Data Structures')).toBeInTheDocument();
  });

  it('adds a course to the solver wanted list', async () => {
    await setup();
    await userEvent.click(screen.getAllByRole('button', { name: '+ Solver' })[0]);
    expect(useScheduleStore.getState().wantedCourseIds).toEqual([10]);
  });

  it('shows professor detail popover on hover', async () => {
    await setup();
    await userEvent.click(screen.getByRole('button', { name: /CPSC 121/ }));
    await userEvent.hover(screen.getByText(/Lee,J ★4\.2/));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('78% would take again');
    expect(screen.getByRole('tooltip')).toHaveTextContent('clear lectures (12)');
  });
});
