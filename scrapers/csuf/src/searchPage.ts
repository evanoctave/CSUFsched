import { buildSearchFields } from './forms.ts';
import type { PeopleSoftSession } from './session.ts';
import type { SearchCriteria } from './types.ts';

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
