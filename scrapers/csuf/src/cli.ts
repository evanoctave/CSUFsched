import { createPool, countSectionsForTerm, updateSectionStatuses } from '@csufsched/db';
import { openSession, DEFAULT_BASE_URL } from './session.ts';
import { parseCatalog } from './catalog.ts';
import { makeSearcher } from './searchPage.ts';
import { fetchUnits } from './detail.ts';
import { persistTerm } from './persist.ts';
import { runFullScrape } from './run.ts';
import { refreshStatuses } from './statusRefresh.ts';
import { rateLimited, fetchWithBackoff } from './rateLimit.ts';
import {
  parseNonNegativeNumber,
  parseRatio,
  parseTermCodes,
  requireCatalogTerm,
} from './validation.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Required env: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== 'full' && mode !== 'status') {
    console.error('Usage: cli.ts <full|status>');
    process.exit(1);
  }

  const databaseUrl = required('DATABASE_URL');
  const baseUrl = process.env.CSUF_BASE_URL ?? DEFAULT_BASE_URL;
  const rateLimitMs = parseNonNegativeNumber('RATE_LIMIT_MS', process.env.RATE_LIMIT_MS, 1000);
  const sanityMinRatio = parseRatio('SANITY_MIN_RATIO', process.env.SANITY_MIN_RATIO, 0.9);
  const termCodes = parseTermCodes(process.env.TERM_CODES);

  const pool = createPool(databaseUrl);
  const limited = rateLimited(
    (url: string, init?: RequestInit) =>
      fetchWithBackoff(url, fetch, { retries: 3, baseDelayMs: rateLimitMs }, init),
    rateLimitMs,
  );
  const session = await openSession({ baseUrl, fetchFn: limited });
  const catalog = parseCatalog(session.entryHtml);

  const search = makeSearcher(session);

  const sectionsForTerm = async (termCode: string): Promise<number> => {
    const res = await pool.query('SELECT id FROM terms WHERE code = $1', [termCode]);
    if (res.rowCount === 0) return 0;
    return countSectionsForTerm(pool, res.rows[0].id as number);
  };

  if (mode === 'full') {
    const summary = await runFullScrape({
      catalog,
      search,
      fetchUnits: (rowIndex) => fetchUnits(session, rowIndex),
      countExistingSections: sectionsForTerm,
      persist: (input) => persistTerm(pool, input),
      sanityMinRatio,
      termCodes,
    });
    console.log(JSON.stringify(summary, null, 2));
    await pool.end();
    process.exit(summary.ok ? 0 : 1);
  }

  const termCode = required('TERM_CODE');
  requireCatalogTerm(catalog, termCode);
  // Never create the term here: an unknown code means a typo or a term the
  // nightly scrape has not built yet, and upserting one would leave the refresh
  // silently updating nothing.
  const termRow = await pool.query('SELECT id FROM terms WHERE code = $1', [termCode]);
  if (termRow.rowCount === 0) {
    console.error(`Term ${termCode} is not in the database yet; run the full scrape first`);
    await pool.end();
    process.exit(1);
  }
  const termId = termRow.rows[0].id as number;
  const summary = await refreshStatuses({
    termCode,
    subjects: catalog.subjects.map((s) => s.code),
    careers: catalog.careers.map((c) => c.code),
    search,
    countExistingSections: () => countSectionsForTerm(pool, termId),
    applyUpdates: (updates) => updateSectionStatuses(pool, termId, updates),
    sanityMinRatio,
  });
  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
  process.exit(summary.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
