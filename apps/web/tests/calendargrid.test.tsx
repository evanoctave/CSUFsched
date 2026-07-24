import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import type { CourseWithSections } from '@csufsched/types';
import { CalendarGrid } from '../src/components/CalendarGrid.tsx';
import { useScheduleStore, STORE_DEFAULTS } from '../src/store.ts';

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
  ],
};

function renderGrid(ghost: Parameters<typeof CalendarGrid>[0]['ghost'] = null) {
  return render(
    <DndContext>
      <CalendarGrid ghost={ghost} />
    </DndContext>,
  );
}

describe('CalendarGrid', () => {
  beforeEach(() => {
    localStorage.clear();
    useScheduleStore.setState(STORE_DEFAULTS);
  });

  it('renders day headers and hour labels', () => {
    renderGrid();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('7:00 AM')).toBeInTheDocument();
    expect(screen.getByText('9:00 PM')).toBeInTheDocument();
  });

  it('renders a placed section block on each meeting day', () => {
    useScheduleStore.getState().placeSection(CPSC121, 1);
    renderGrid();
    expect(screen.getAllByText('CPSC 121')).toHaveLength(2); // M and W
  });

  it('renders busy blocks and removes one on click', async () => {
    useScheduleStore.getState().addBusyBlock({ day: 'Tu', startMin: 600, endMin: 720 });
    renderGrid();
    const block = screen.getByRole('button', { name: /busy 10:00 AM–12:00 PM/i });
    await userEvent.click(block);
    expect(useScheduleStore.getState().busyBlocks).toHaveLength(0);
  });

  it('renders a red ghost when conflict', () => {
    renderGrid({ section: CPSC121.sections[0], conflict: true });
    const ghosts = screen.getAllByTestId('ghost-block');
    expect(ghosts).toHaveLength(2);
    expect(ghosts[0].className).toContain('bg-red');
  });
});
