import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import {
  runSearch,
  resetSearch,
  isWarningPage,
  isResultsPage,
  SEARCH_ACTION,
  WARNING_CONTINUE_ACTION,
  NEW_SEARCH_ACTION,
} from '../src/searchPage';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const warning = fs.readFileSync(path.join(dir, 'warning.html'), 'utf8');
const results = fs.readFileSync(path.join(dir, 'results-cpsc.html'), 'utf8');
const noResults = fs.readFileSync(path.join(dir, 'no-results.html'), 'utf8');

const criteria = { termCode: '2267', subject: 'CPSC', career: 'UGRD' };

describe('page detection', () => {
  it('recognises the over-50 interstitial', () => {
    expect(isWarningPage(warning)).toBe(true);
    expect(isWarningPage(results)).toBe(false);
  });

  it('recognises a results page', () => {
    expect(isResultsPage(results)).toBe(true);
    expect(isResultsPage(noResults)).toBe(false);
  });
});

describe('runSearch', () => {
  it('posts the criteria and returns the results HTML', async () => {
    const post = vi.fn().mockResolvedValueOnce(results);
    const html = await runSearch({ post } as never, criteria);

    expect(html).toBe(results);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(SEARCH_ACTION);
    expect(post.mock.calls[0][1]['SSR_CLSRCH_WRK_SUBJECT_SRCH$0']).toBe('CPSC');
    expect(post.mock.calls[0][1]['CLASS_SRCH_WRK2_STRM$35$']).toBe('2267');
  });

  it('auto-continues through the over-50 interstitial', async () => {
    const post = vi.fn().mockResolvedValueOnce(warning).mockResolvedValueOnce(results);
    const html = await runSearch({ post } as never, criteria);

    expect(html).toBe(results);
    expect(post.mock.calls[1]).toEqual([WARNING_CONTINUE_ACTION, { ICSaveWarningFilter: '1' }]);
  });

  it('returns null when the search matches nothing', async () => {
    const post = vi.fn().mockResolvedValueOnce(noResults);
    expect(await runSearch({ post } as never, criteria)).toBeNull();
  });

  it('throws when the response is neither results nor an empty entry page', async () => {
    const post = vi.fn().mockResolvedValueOnce('<html>garbage</html>');
    await expect(runSearch({ post } as never, criteria)).rejects.toThrow(/unexpected page/i);
  });
});

describe('resetSearch', () => {
  it('posts the New Search action', async () => {
    const post = vi.fn().mockResolvedValue('<PAGE id="SSR_CLSRCH_ENTRY"></PAGE>');
    await resetSearch({ post } as never);
    expect(post).toHaveBeenCalledWith(NEW_SEARCH_ACTION);
  });
});
