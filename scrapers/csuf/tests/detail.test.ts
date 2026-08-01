import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { parseUnitsRange, detailAction, fetchUnits, DETAIL_BACK_ACTION } from '../src/detail';
import { SessionResetError } from '../src/session';

const detailHtml = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'detail.html'),
  'utf8',
);

describe('parseUnitsRange', () => {
  it('strips the "units" suffix from a real detail page', () => {
    expect(parseUnitsRange(detailHtml)).toMatch(/^\d+(\s*-\s*\d+)?$/);
  });

  it('keeps a range intact', () => {
    const html = `<span id='SSR_CLS_DTL_WRK_UNITS_RANGE'>1 - 3 units</span>`;
    expect(parseUnitsRange(html)).toBe('1 - 3');
  });

  it('throws when the units field is absent', () => {
    expect(() => parseUnitsRange('<html>no units here</html>')).toThrow(/units/i);
  });
});

describe('detailAction', () => {
  it('targets the class-number link of a results row', () => {
    expect(detailAction(7)).toBe('MTG_CLASS_NBR$7');
  });
});

describe('fetchUnits', () => {
  it('opens the detail page, reads units, and returns to the results page', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(`<span id='SSR_CLS_DTL_WRK_UNITS_RANGE'>3 units</span>`)
      .mockResolvedValueOnce('<PAGE id="SSR_CLSRCH_RSLT"></PAGE>');

    const units = await fetchUnits({ post } as never, 4);

    expect(units).toBe('3');
    expect(post.mock.calls[0][0]).toBe('MTG_CLASS_NBR$4');
    expect(post.mock.calls[1][0]).toBe(DETAIL_BACK_ACTION);
  });

  it('still navigates back when the detail page cannot be parsed', async () => {
    const post = vi.fn().mockResolvedValueOnce('<html>unexpected</html>').mockResolvedValueOnce('ok');

    await expect(fetchUnits({ post } as never, 1)).rejects.toThrow(/units/i);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0]).toBe(DETAIL_BACK_ACTION);
  });

  it('keeps the units it parsed and reopens when the back navigation fails', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(`<span id='SSR_CLS_DTL_WRK_UNITS_RANGE'>3 units</span>`)
      .mockRejectedValueOnce(new Error('network down'));
    const reopen = vi.fn(async () => {});

    expect(await fetchUnits({ post, reopen } as never, 4)).toBe('3');
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it('does not reopen when the back navigation already reset the session', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(`<span id='SSR_CLS_DTL_WRK_UNITS_RANGE'>3 units</span>`)
      .mockRejectedValueOnce(new SessionResetError(DETAIL_BACK_ACTION));
    const reopen = vi.fn(async () => {});

    expect(await fetchUnits({ post, reopen } as never, 4)).toBe('3');
    expect(reopen).not.toHaveBeenCalled();
  });

  it('reports the parse failure when the back navigation fails too', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce('<html>unexpected</html>')
      .mockRejectedValueOnce(new Error('network down'));
    const reopen = vi.fn(async () => {});

    await expect(fetchUnits({ post, reopen } as never, 1)).rejects.toThrow(/units/i);
    expect(reopen).toHaveBeenCalledTimes(1);
  });
});
