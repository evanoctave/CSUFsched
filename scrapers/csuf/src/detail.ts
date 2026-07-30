import type { PeopleSoftSession } from './session.ts';

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
// button, so the back POST has to happen even when parsing fails.
export async function fetchUnits(session: PeopleSoftSession, rowIndex: number): Promise<string> {
  const html = await session.post(detailAction(rowIndex));
  try {
    return parseUnitsRange(html);
  } finally {
    await session.post(DETAIL_BACK_ACTION);
  }
}
