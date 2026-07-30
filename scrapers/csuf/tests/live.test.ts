import { describe, it, expect } from 'vitest';
import { openSession, DEFAULT_BASE_URL } from '../src/session';
import { parseCatalog } from '../src/catalog';
import { runSearch } from '../src/searchPage';
import { parseResultRows } from '../src/parseResults';
import { fetchUnits } from '../src/detail';
import { rateLimited, fetchWithBackoff } from '../src/rateLimit';

const LIVE = process.env.LIVE_SCRAPE === '1';

describe.skipIf(!LIVE)('live CSUF class search', () => {
  it('opens a session, searches CPSC, and reads units from a detail page', async () => {
    const limited = rateLimited(
      (url: string, init?: RequestInit) => fetchWithBackoff(url, fetch, { retries: 2, baseDelayMs: 1000 }, init),
      1000,
    );
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn: limited });
    const catalog = parseCatalog(session.entryHtml);
    expect(catalog.subjects.length).toBeGreaterThan(80);

    const termCode = catalog.terms[0].code;
    const html = await runSearch(session, { termCode, subject: 'CPSC', career: 'UGRD' });
    expect(html).not.toBeNull();

    const { rows, skipped } = parseResultRows(html!);
    expect(rows.length).toBeGreaterThan(20);
    expect(skipped).toHaveLength(0);

    const units = await fetchUnits(session, rows[0].rowIndex);
    expect(units).toMatch(/^\d+(\s*-\s*\d+)?$/);
  }, 180_000);
});
