import { SessionResetError, type PeopleSoftSession } from './session.ts';

export const DETAIL_BACK_ACTION = 'CLASS_SRCH_WRK2_SSR_PB_BACK';

export function detailAction(rowIndex: number): string {
  return `MTG_CLASS_NBR$${rowIndex}`;
}

export function parseUnitsRange(html: string): string {
  const m = /id='SSR_CLS_DTL_WRK_UNITS_RANGE'[^>]*>([^<]*)</.exec(html);
  if (m === null) throw new Error('detail page carried no units field');
  const value = m[1].replace(/units?/i, '').trim();
  if (value === '') throw new Error('detail page carried an empty units field');
  return value;
}

// The results page is only reachable again through the "View Search Results"
// button, so the back POST has to happen even when parsing fails. If it fails
// too the session is stranded on the detail page, where no later action means
// anything, so start a fresh one rather than let every following request return
// the wrong page. A units value already parsed is still good and is returned.
export async function fetchUnits(session: PeopleSoftSession, rowIndex: number): Promise<string> {
  const html = await session.post(detailAction(rowIndex));
  let units: string | null = null;
  let parseError: unknown = null;
  try {
    units = parseUnitsRange(html);
  } catch (err) {
    parseError = err;
  }

  try {
    await session.post(DETAIL_BACK_ACTION);
  } catch (err) {
    // A SessionResetError means post() already opened a fresh session.
    if (!(err instanceof SessionResetError)) await session.reopen();
  }

  if (units === null) throw parseError;
  return units;
}
