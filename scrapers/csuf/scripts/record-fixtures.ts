import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession, DEFAULT_BASE_URL } from '../src/session.ts';
import { buildSearchFields } from '../src/forms.ts';
import { rateLimited, fetchWithBackoff } from '../src/rateLimit.ts';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const SEARCH = 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH';
const CONTINUE = '#ICSave';
const NEW_SEARCH = 'CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH$3$';
const BACK = 'CLASS_SRCH_WRK2_SSR_PB_BACK';

function trimToGroups(html: string, groups: number): string {
  const marker = /title='Collapse section /g;
  let cut = -1;
  for (let i = 0; i <= groups; i += 1) {
    const m = marker.exec(html);
    if (m === null) return html;
    cut = m.index;
  }
  const kept = `${html.slice(0, cut)}\n<!-- fixture truncated after ${groups} course groups -->\n`;
  // The page's own section count is cross-checked against the rows read from
  // it, so a truncated fixture has to carry the count it was truncated to or
  // it looks like a page that lost rows.
  const rows = (kept.match(/id='MTG_CLASS_NBR\$\d+'[^>]*>\d+<\/a>/g) ?? []).length;
  return kept.replace(/\d+ class section\(s\) found/, `${rows} class section(s) found`);
}

const limited = rateLimited(
  (url: string, init?: RequestInit) =>
    fetchWithBackoff(url, fetch, { retries: 3, baseDelayMs: 1000 }, init),
  1000,
);

const run = async (): Promise<void> => {
  await fs.mkdir(OUT, { recursive: true });
  const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn: limited });
  await fs.writeFile(path.join(OUT, 'entry.html'), session.entryHtml);

  const termCode = process.env.FIXTURE_TERM ?? '2267';

  const warning = await session.post(SEARCH, buildSearchFields({ termCode, subject: 'CPSC', career: 'UGRD' }));
  await fs.writeFile(path.join(OUT, 'warning.html'), warning);

  const cpsc = await session.post(CONTINUE, { ICSaveWarningFilter: '1' });
  await fs.writeFile(path.join(OUT, 'results-cpsc.html'), trimToGroups(cpsc, 3));

  const detail = await session.post('MTG_CLASS_NBR$0');
  await fs.writeFile(path.join(OUT, 'detail.html'), detail);
  await session.post(BACK);

  await session.post(NEW_SEARCH);
  const histWarning = await session.post(SEARCH, buildSearchFields({ termCode, subject: 'HIST', career: 'UGRD' }));
  const hist = histWarning.includes('SSR_SS_WARNING')
    ? await session.post(CONTINUE, { ICSaveWarningFilter: '1' })
    : histWarning;
  await fs.writeFile(path.join(OUT, 'results-online.html'), trimToGroups(hist, 2));

  await session.post(NEW_SEARCH);
  const empty = await session.post(SEARCH, buildSearchFields({ termCode, subject: 'AFAM', career: 'EXED' }));
  await fs.writeFile(path.join(OUT, 'no-results.html'), empty);

  console.log(`fixtures written to ${OUT}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
