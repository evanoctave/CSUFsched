import { createPool, countSectionsForTerm, updateSectionStatuses, upsertTerm } from '@csufsched/db';
import { openSession, DEFAULT_BASE_URL } from './session.ts';
import { parseCatalog } from './catalog.ts';
import { makeSearcher } from './searchPage.ts';
import { fetchUnits } from './detail.ts';
import { persistTerm } from './persist.ts';
import { runFullScrape } from './run.ts';
import { refreshStatuses } from './statusRefresh.ts';
import { rateLimited, fetchWithBackoff } from './rateLimit.ts';

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
  const rateLimitMs = Number(process.env.RATE_LIMIT_MS ?? '1000');
  const sanityMinRatio = Number(process.env.SANITY_MIN_RATIO ?? '0.9');

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
      termCodes: process.env.TERM_CODES?.split(',').filter(Boolean),
    });
    console.log(JSON.stringify(summary, null, 2));
    await pool.end();
    process.exit(summary.ok ? 0 : 1);
  }

  const termCode = required('TERM_CODE');
  const termId = await upsertTerm(pool, { code: termCode, name: process.env.TERM_NAME ?? termCode });
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
