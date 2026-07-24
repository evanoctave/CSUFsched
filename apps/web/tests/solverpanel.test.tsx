import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CourseWithSections } from '@csufsched/types';
import { SolverPanel } from '../src/components/SolverPanel.tsx';
import { useScheduleStore, STORE_DEFAULTS } from '../src/store.ts';

function makeCourse(
  id: number,
  catalogNbr: string,
  units: number,
  sections: Array<{ id: number; days: CourseWithSections['sections'][number]['meetings'][number]['days']; startMin: number; endMin: number }>,
): CourseWithSections {
  return {
    id,
    deptCode: 'CPSC',
    catalogNbr,
    title: `Course ${catalogNbr}`,
    units,
    sections: sections.map((s) => ({
      id: s.id,
      courseId: id,
      classNbr: String(10000 + s.id),
      sectionCode: '01',
      mode: 'in-person',
      enrollmentStatus: 'open',
      professor: null,
      meetings: [{ days: s.days, startMin: s.startMin, endMin: s.endMin }],
    })),
  };
}

const C1 = makeCourse(10, '121', 3, [
  { id: 1, days: ['M', 'W'], startMin: 600, endMin: 675 },
  { id: 2, days: ['Tu', 'Th'], startMin: 600, endMin: 675 },
]);
const C2 = makeCourse(11, '131', 4, [{ id: 3, days: ['F'], startMin: 720, endMin: 840 }]);
const BIG = makeCourse(12, '999', 15, [{ id: 4, days: ['Sa'], startMin: 600, endMin: 700 }]);

describe('SolverPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useScheduleStore.setState({ ...STORE_DEFAULTS, termId: 1, termName: 'Fall 2026' });
  });

  it('lists wanted courses with a unit counter', () => {
    const s = useScheduleStore.getState();
    s.addWantedCourse(C1);
    s.addWantedCourse(C2);
    render(<SolverPanel />);
    expect(screen.getByText('7 units')).toBeInTheDocument();
    expect(screen.queryByText(/Over 18 units/)).not.toBeInTheDocument();
  });

  it('warns above 18 units but keeps Generate enabled', () => {
    const s = useScheduleStore.getState();
    s.addWantedCourse(C1);
    s.addWantedCourse(C2);
    s.addWantedCourse(BIG);
    render(<SolverPanel />);
    expect(screen.getByText(/Over 18 units/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate schedules' })).toBeEnabled();
  });

  it('generates candidates and loads one onto the grid', async () => {
    const s = useScheduleStore.getState();
    s.addWantedCourse(C1);
    s.addWantedCourse(C2);
    render(<SolverPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate schedules' }));
    const candidates = await screen.findAllByTestId('candidate');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(5);
    await userEvent.click(candidates[0]);
    const placed = useScheduleStore.getState().placedSectionIds;
    expect(placed).toContain(3);
    expect(placed).toHaveLength(2);
  });

  it('explains eliminations when no schedule exists', async () => {
    const s = useScheduleStore.getState();
    s.addWantedCourse(C2);
    s.addBusyBlock({ day: 'F', startMin: 700, endMin: 900 });
    render(<SolverPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate schedules' }));
    expect(screen.getByText(/CPSC 131:.*busy-block/)).toBeInTheDocument();
  });

  it('respects avoid-day prefs via checkboxes', async () => {
    const s = useScheduleStore.getState();
    s.addWantedCourse(C1);
    render(<SolverPanel />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mon' }));
    expect(useScheduleStore.getState().prefs.avoidDays).toEqual(['M']);
    await userEvent.click(screen.getByRole('button', { name: 'Generate schedules' }));
    const candidates = await screen.findAllByTestId('candidate');
    expect(candidates).toHaveLength(1); // only the TuTh section survives
  });

  it('disables Generate with no wanted courses', () => {
    render(<SolverPanel />);
    expect(screen.getByRole('button', { name: 'Generate schedules' })).toBeDisabled();
  });
});
