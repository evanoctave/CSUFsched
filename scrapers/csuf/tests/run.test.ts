import { describe, it, expect, vi, type MockedFunction } from 'vitest';
import { runFullScrape } from '../src/run';
import type { SearchOutcome } from '../src/searchPage';
import type { RawClassRow, ResultRow, PersistInput, PersistResult, SearchCriteria } from '../src/types';

function row(overrides: Partial<RawClassRow> = {}): RawClassRow {
  return {
    subject: 'CPSC',
    catalog_nbr: '121',
    descr: 'OOP',
    units: '',
    class_nbr: '12345',
    class_section: '01',
    instructor: 'Lee,J',
    meeting_days: 'MoWe',
    start_time: '10:00AM',
    end_time: '10:50AM',
    building: 'CS',
    room: '101',
    instruction_mode: 'P',
    enrollment_status: 'O',
    ...overrides,
  };
}

function resultRow(rowIndex: number, overrides: Partial<RawClassRow> = {}): ResultRow {
  return { rowIndex, row: row(overrides) };
}

function outcome(rows: ResultRow[], skipped: SearchOutcome['skipped'] = []): SearchOutcome {
  return { rows, skipped };
}

interface TestDeps {
  catalog: Parameters<typeof runFullScrape>[0]['catalog'];
  search: MockedFunction<(criteria: SearchCriteria) => Promise<SearchOutcome>>;
  fetchUnits: MockedFunction<(rowIndex: number) => Promise<string>>;
  countExistingSections: MockedFunction<(termCode: string) => Promise<number>>;
  persist: MockedFunction<(input: PersistInput) => Promise<PersistResult>>;
  sanityMinRatio: number;
  termCodes?: string[];
}

function deps(over: Partial<TestDeps> = {}): TestDeps {
  return {
    catalog: {
      terms: [{ code: '2267', name: 'Fall 2026' }],
      subjects: [{ code: 'CPSC', name: 'Computer Science' }],
      careers: [{ code: 'UGRD', name: 'Undergraduate' }],
    },
    search: vi.fn<(criteria: SearchCriteria) => Promise<SearchOutcome>>(
      async () => outcome([resultRow(0), resultRow(1, { class_nbr: '12346', class_section: '02' })]),
    ),
    fetchUnits: vi.fn<(rowIndex: number) => Promise<string>>(async () => '3'),
    countExistingSections: vi.fn<(termCode: string) => Promise<number>>(async () => 0),
    persist: vi.fn<(input: PersistInput) => Promise<PersistResult>>(async () => ({
      termId: 1, coursesUpserted: 1, sectionsUpserted: 2, coursesDeleted: 0, sectionsDeleted: 0,
    })),
    sanityMinRatio: 0.9,
    ...over,
  };
}

describe('runFullScrape', () => {
  it('searches every term x subject x career and persists the parsed courses', async () => {
    const d = deps();
    const summary = await runFullScrape(d);

    expect(d.search).toHaveBeenCalledWith({ termCode: '2267', subject: 'CPSC', career: 'UGRD' });
    expect(d.persist).toHaveBeenCalledTimes(1);
    expect(summary.searchesRun).toBe(1);
    expect(summary.sectionsParsed).toBe(2);
    expect(summary.terms[0].persisted?.sectionsUpserted).toBe(2);
  });

  it('fetches one detail page per course, not per section', async () => {
    const d = deps();
    await runFullScrape(d);
    expect(d.fetchUnits).toHaveBeenCalledTimes(1);
    expect(d.fetchUnits).toHaveBeenCalledWith(0);
  });

  it('reuses the cached units when the same course appears under another career', async () => {
    const d = deps({
      catalog: {
        terms: [{ code: '2267', name: 'Fall 2026' }],
        subjects: [{ code: 'CPSC', name: 'Computer Science' }],
        careers: [
          { code: 'UGRD', name: 'Undergraduate' },
          { code: 'PBAC', name: 'Postbaccalaureate' },
        ],
      },
    });
    await runFullScrape(d);
    expect(d.search).toHaveBeenCalledTimes(2);
    expect(d.fetchUnits).toHaveBeenCalledTimes(1);
  });

  it('passes real department names through to persist', async () => {
    const d = deps();
    await runFullScrape(d);
    expect(d.persist.mock.calls[0][0].departmentNames.get('CPSC')).toBe('Computer Science');
  });

  it('records a failed search and keeps going', async () => {
    const d = deps({
      catalog: {
        terms: [{ code: '2267', name: 'Fall 2026' }],
        subjects: [
          { code: 'CPSC', name: 'Computer Science' },
          { code: 'MATH', name: 'Mathematics' },
        ],
        careers: [{ code: 'UGRD', name: 'Undergraduate' }],
      },
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(outcome([resultRow(0, { subject: 'MATH', catalog_nbr: '150B' })])),
    });
    const summary = await runFullScrape(d);

    expect(summary.searchErrors).toEqual([{ term: '2267', subject: 'CPSC', career: 'UGRD', error: 'boom' }]);
    expect(d.persist).toHaveBeenCalledTimes(1);
  });

  it('reports the result rows the HTML parser skipped', async () => {
    const d = deps({
      search: vi.fn<(criteria: SearchCriteria) => Promise<SearchOutcome>>(
        async () => outcome([resultRow(0)], [{ rowIndex: 4, error: 'unknown instruction mode "Zoom"' }]),
      ),
    });
    const summary = await runFullScrape(d);

    expect(summary.resultRowsSkipped).toEqual([
      {
        term: '2267',
        subject: 'CPSC',
        career: 'UGRD',
        rowIndex: 4,
        error: 'unknown instruction mode "Zoom"',
      },
    ]);
  });

  it('records a failed detail fetch and skips that course', async () => {
    const d = deps({ fetchUnits: vi.fn<(rowIndex: number) => Promise<string>>(async () => { throw new Error('detail down'); }) });
    const summary = await runFullScrape(d);

    expect(summary.detailErrors).toHaveLength(1);
    expect(summary.detailErrors[0].course).toBe('CPSC 121');
    expect(d.persist.mock.calls[0][0].courses).toHaveLength(0);
  });

  it('aborts the term without writing when the sanity ratio is not met', async () => {
    const d = deps({ countExistingSections: vi.fn<(termCode: string) => Promise<number>>(async () => 100) });
    const summary = await runFullScrape(d);

    expect(d.persist).not.toHaveBeenCalled();
    expect(summary.terms[0].abortedBySanityGate).toBe(true);
    expect(summary.ok).toBe(false);
  });

  it('passes the gate on a first run against an empty database', async () => {
    const d = deps({ countExistingSections: vi.fn<(termCode: string) => Promise<number>>(async () => 0) });
    const summary = await runFullScrape(d);

    expect(d.persist).toHaveBeenCalledTimes(1);
    expect(summary.ok).toBe(true);
  });

  it('honours a term filter', async () => {
    const d = deps({
      catalog: {
        terms: [
          { code: '2267', name: 'Fall 2026' },
          { code: '2265', name: 'Summer 2026' },
        ],
        subjects: [{ code: 'CPSC', name: 'Computer Science' }],
        careers: [{ code: 'UGRD', name: 'Undergraduate' }],
      },
      termCodes: ['2265'],
    });
    await runFullScrape(d);
    expect(d.search).toHaveBeenCalledTimes(1);
    expect(d.search.mock.calls[0][0].termCode).toBe('2265');
  });
});
