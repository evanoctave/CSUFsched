import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareBar } from '../src/components/ShareBar';
import { useScheduleStore, STORE_DEFAULTS } from '../src/store';
import { parseShareHash } from '../src/lib/share';
import type { CourseWithSections } from '@csufsched/types';

const COURSE: CourseWithSections = {
  id: 1,
  deptCode: 'CPSC',
  catalogNbr: '121',
  title: 'Programming I',
  units: 3,
  sections: [
    {
      id: 11,
      courseId: 1,
      classNbr: '12345',
      sectionCode: '01',
      mode: 'in-person',
      enrollmentStatus: 'open',
      professor: null,
      meetings: [{ days: ['M', 'W'], startMin: 600, endMin: 675, building: 'CS', room: '101' }],
    },
  ],
};

beforeEach(() => {
  useScheduleStore.setState({ ...STORE_DEFAULTS });
  localStorage.clear();
});

describe('ShareBar', () => {
  it('renders nothing when no term selected', () => {
    const { container } = render(<ShareBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('share link href encodes current schedule', () => {
    useScheduleStore.setState({
      termId: 7,
      termName: 'Fall 2026',
      catalog: { 1: COURSE },
      placedSectionIds: [11],
      busyBlocks: [{ day: 'Tu', startMin: 540, endMin: 600 }],
    });
    render(<ShareBar />);
    const link = screen.getByTestId('share-link') as HTMLAnchorElement;
    const payload = parseShareHash(new URL(link.href).hash);
    expect(payload).toEqual({
      termId: 7,
      sectionIds: [11],
      busyBlocks: [{ day: 'Tu', startMin: 540, endMin: 600 }],
    });
  });

  it('clicking copy writes url to clipboard and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    useScheduleStore.setState({ termId: 7, termName: 'Fall 2026' });
    render(<ShareBar />);
    await userEvent.click(screen.getByTestId('share-link'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#s='));
    expect(screen.getByText('Copied!')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('export .ics triggers a download when sections placed', async () => {
    useScheduleStore.setState({
      termId: 7,
      termName: 'Fall 2026',
      catalog: { 1: COURSE },
      placedSectionIds: [11],
    });
    const createUrl = vi.fn().mockReturnValue('blob:fake');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', Object.assign(Object.create(URL), URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    render(<ShareBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Export .ics' }));
    expect(createUrl).toHaveBeenCalledTimes(1);
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/calendar');
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
    vi.unstubAllGlobals();
  });

  it('export button disabled with no placed sections', () => {
    useScheduleStore.setState({ termId: 7, termName: 'Fall 2026' });
    render(<ShareBar />);
    expect(screen.getByRole('button', { name: 'Export .ics' })).toBeDisabled();
  });
});
