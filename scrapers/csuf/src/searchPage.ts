import { buildSearchFields } from './forms.ts';
import { parseResultRows } from './parseResults.ts';
import { SessionResetError, type PeopleSoftSession } from './session.ts';
import type { ResultRow, SearchCriteria } from './types.ts';

export const SEARCH_ACTION = 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH';
export const WARNING_CONTINUE_ACTION = '#ICSave';
export const NEW_SEARCH_ACTION = 'CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH$3$';

export function isWarningPage(html: string): boolean {
  return html.includes('SSR_SS_WARNING');
}

export function isResultsPage(html: string): boolean {
  return html.includes('SSR_CLSRCH_RSLT') && html.includes("id='MTG_CLASS_NBR$");
}

function isEmptyEntryPage(html: string): boolean {
  return html.includes('SSR_CLSRCH_ENTRY') && !html.includes("id='MTG_CLASS_NBR$");
}

// Returns null for a search that legitimately matched no classes — PeopleSoft
// answers those with the entry page and no message at all.
export async function runSearch(
  session: PeopleSoftSession,
  criteria: SearchCriteria,
): Promise<string | null> {
  let html = await session.post(SEARCH_ACTION, buildSearchFields(criteria));
  if (isWarningPage(html)) {
    html = await session.post(WARNING_CONTINUE_ACTION, { ICSaveWarningFilter: '1' });
  }
  if (isResultsPage(html)) return html;
  if (isEmptyEntryPage(html)) return null;
  throw new Error(
    `unexpected page for ${criteria.subject}/${criteria.career}/${criteria.termCode}`,
  );
}

// Mandatory between searches: without it PeopleSoft replays the previous results.
export async function resetSearch(session: PeopleSoftSession): Promise<void> {
  await session.post(NEW_SEARCH_ACTION);
}

export interface SearchOutcome {
  rows: ResultRow[];
  skipped: Array<{ rowIndex: number; error: string }>;
  reported: number | null;
}

// Detail fetches return to the results page themselves, so the only extra
// navigation is resetting the previous search before opening the next one.
export function makeSearcher(
  session: PeopleSoftSession,
): (criteria: SearchCriteria) => Promise<SearchOutcome> {
  let needsReset = false;
  let resultsGeneration = session.generation;

  const attempt = async (criteria: SearchCriteria): Promise<SearchOutcome> => {
    if (needsReset) {
      if (session.generation === resultsGeneration) await resetSearch(session);
      needsReset = false;
    }
    needsReset = true;
    const html = await runSearch(session, criteria);
    needsReset = html !== null;
    resultsGeneration = session.generation;
    // A search that matched nothing carries no tally, but zero is what it
    // found, and saying so keeps it from reading as a lost-rows shortfall.
    return html === null ? { rows: [], skipped: [], reported: 0 } : parseResultRows(html);
  };

  return async (criteria) => {
    try {
      return await attempt(criteria);
    } catch (err) {
      if (!(err instanceof SessionResetError)) throw err;
      needsReset = false;
      return attempt(criteria);
    }
  };
}
