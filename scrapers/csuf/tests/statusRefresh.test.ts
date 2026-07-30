import { describe, it, expect, vi, type MockedFunction } from 'vitest';
import { refreshStatuses } from '../src/statusRefresh';
import type { SearchOutcome } from '../src/searchPage';
import type { RawClassRow, ResultRow, SearchCriteria } from '../src/types';

function resultRow(rowIndex: number, classNbr: string, status: string): ResultRow {
  const row: RawClassRow = {
    subject: 'CPSC', catalog_nbr: '121', descr: 'OOP', units: '',
    class_nbr: classNbr, class_section: '01', instructor: 'Lee,J',
    meeting_days: 'MoWe', start_time: '10:00AM', end_time: '10:50AM',
    building: 'CS', room: '101', instruction_mode: 'P', enrollment_status: status,
  };
  return { rowIndex, row };
}

function outcome(rows: ResultRow[], skipped: SearchOutcome['skipped'] = []): SearchOutcome {
  return { rows, skipped };
}

interface TestDeps {
  termCode: string;
  subjects: string[];
  careers: string[];
  search: MockedFunction<(criteria: SearchCriteria) => Promise<SearchOutcome>>;
  countExistingSections: MockedFunction<() => Promise<number>>;
  applyUpdates: MockedFunction<(updates: Array<{ classNbr: string; status: string }>) => Promise<number>>;
  sanityMinRatio: number;
}

function deps(over: Partial<TestDeps> = {}): TestDeps {
  return {
    termCode: '2267',
    subjects: ['CPSC', 'MATH'],
    careers: ['UGRD'],
    search: vi.fn<(criteria: SearchCriteria) => Promise<SearchOutcome>>(
      async () => outcome([resultRow(0, '12345', 'O'), resultRow(1, '12346', 'W')]),
    ),
    countExistingSections: vi.fn<() => Promise<number>>(async () => 4),
    applyUpdates: vi.fn<(updates: Array<{ classNbr: string; status: string }>) => Promise<number>>(async () => 2),
    sanityMinRatio: 0.9,
    ...over,
  };
}

describe('refreshStatuses', () => {
  it('searches every subject x career for the one term and applies mapped statuses', async () => {
    const d = deps();
    const summary = await refreshStatuses(d);

    expect(d.search).toHaveBeenCalledTimes(2);
    expect(d.search.mock.calls[0][0]).toEqual({ termCode: '2267', subject: 'CPSC', career: 'UGRD' });
    expect(d.applyUpdates).toHaveBeenCalledWith([
      { classNbr: '12345', status: 'open' },
      { classNbr: '12346', status: 'waitlist' },
      { classNbr: '12345', status: 'open' },
      { classNbr: '12346', status: 'waitlist' },
    ]);
    expect(summary.sectionsObserved).toBe(4);
    expect(summary.sectionsUpdated).toBe(2);
    expect(summary.ok).toBe(true);
  });

  it('skips a row whose status icon is unknown and reports it', async () => {
    const d = deps({
      search: vi.fn<(criteria: SearchCriteria) => Promise<SearchOutcome>>(
        async () => outcome([resultRow(0, '12345', 'X')]),
      ),
      subjects: ['CPSC'],
      countExistingSections: vi.fn<() => Promise<number>>(async () => 1),
    });
    const summary = await refreshStatuses(d);

    expect(summary.rowsSkipped).toHaveLength(1);
    expect(d.applyUpdates).toHaveBeenCalledWith([]);
  });

  it('reports the result rows the HTML parser skipped', async () => {
    const d = deps({
      subjects: ['CPSC'],
      search: vi.fn<(criteria: SearchCriteria) => Promise<SearchOutcome>>(
        async () => outcome([resultRow(0, '12345', 'O')], [{ rowIndex: 7, error: 'field MTG_ROOM$7 not found' }]),
      ),
      countExistingSections: vi.fn<() => Promise<number>>(async () => 1),
    });
    const summary = await refreshStatuses(d);

    expect(summary.resultRowsSkipped).toEqual([
      { subject: 'CPSC', career: 'UGRD', rowIndex: 7, error: 'field MTG_ROOM$7 not found' },
    ]);
  });

  it('aborts without writing when it observes too few sections', async () => {
    const d = deps({ countExistingSections: vi.fn<() => Promise<number>>(async () => 1000) });
    const summary = await refreshStatuses(d);

    expect(d.applyUpdates).not.toHaveBeenCalled();
    expect(summary.abortedBySanityGate).toBe(true);
    expect(summary.ok).toBe(false);
  });

  it('records a failed search and keeps going', async () => {
    const d = deps({
      search: vi
        .fn<(criteria: SearchCriteria) => Promise<SearchOutcome>>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(outcome([resultRow(0, '12345', 'C')])),
      countExistingSections: vi.fn<() => Promise<number>>(async () => 1),
    });
    const summary = await refreshStatuses(d);

    expect(summary.searchErrors).toEqual([{ subject: 'CPSC', career: 'UGRD', error: 'boom' }]);
    expect(d.applyUpdates).toHaveBeenCalledWith([{ classNbr: '12345', status: 'closed' }]);
  });
});
