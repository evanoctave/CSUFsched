import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import {
  runSearch,
  resetSearch,
  makeSearcher,
  isWarningPage,
  isResultsPage,
  SEARCH_ACTION,
  WARNING_CONTINUE_ACTION,
  NEW_SEARCH_ACTION,
} from '../src/searchPage';
import { SessionResetError } from '../src/session';

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

describe('makeSearcher', () => {
  const actions = (post: ReturnType<typeof vi.fn>): string[] =>
    post.mock.calls.map((c) => c[0] as string);

  it('resets between two searches that both returned results, but not before the first', async () => {
    const post = vi.fn().mockResolvedValue(results);
    const search = makeSearcher({ post } as never);

    const first = await search(criteria);
    const second = await search({ ...criteria, subject: 'MATH' });

    expect(first.rows.length).toBeGreaterThan(0);
    expect(second.rows.length).toBeGreaterThan(0);
    expect(actions(post)).toEqual([SEARCH_ACTION, NEW_SEARCH_ACTION, SEARCH_ACTION]);
  });

  it('reports the rows the HTML parser skipped', async () => {
    const post = vi.fn().mockResolvedValue(results);
    const outcome = await makeSearcher({ post } as never)(criteria);
    expect(Array.isArray(outcome.skipped)).toBe(true);
  });

  it('does not reset after a search that matched nothing', async () => {
    const post = vi.fn().mockResolvedValueOnce(noResults).mockResolvedValueOnce(results);
    const search = makeSearcher({ post } as never);

    expect(await search(criteria)).toEqual({ rows: [], skipped: [] });
    await search({ ...criteria, subject: 'MATH' });

    expect(actions(post)).toEqual([SEARCH_ACTION, SEARCH_ACTION]);
  });

  it('resets after a search that threw, since the session is on an unknown page', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce('<html>garbage</html>')
      .mockResolvedValue(results);
    const search = makeSearcher({ post } as never);

    await expect(search(criteria)).rejects.toThrow(/unexpected page/i);
    await search({ ...criteria, subject: 'MATH' });

    expect(actions(post)).toEqual([SEARCH_ACTION, NEW_SEARCH_ACTION, SEARCH_ACTION]);
  });

  it('retries the whole search once after expiry during warning continuation', async () => {
    let generation = 1;
    let call = 0;
    const post = vi.fn(async (action: string) => {
      call += 1;
      if (call === 1) return warning;
      if (call === 2) {
        generation = 2;
        throw new SessionResetError(action);
      }
      return results;
    });
    const session = {
      entryHtml: '',
      get generation() {
        return generation;
      },
      post,
      reopen: vi.fn(async () => {}),
    };

    const outcome = await makeSearcher(session)(criteria);

    expect(outcome.rows.length).toBeGreaterThan(0);
    expect(actions(session.post)).toEqual([
      SEARCH_ACTION,
      WARNING_CONTINUE_ACTION,
      SEARCH_ACTION,
    ]);
  });

  it('retries from entry after expiry during new-search reset', async () => {
    const session = {
      entryHtml: '',
      generation: 1,
      post: vi.fn().mockResolvedValue(results),
      reopen: vi.fn(async () => {}),
    };
    const search = makeSearcher(session);
    await search(criteria);
    session.post.mockImplementationOnce(async (action: string) => {
      session.generation = 2;
      throw new SessionResetError(action);
    });

    await search({ ...criteria, subject: 'MATH' });

    expect(actions(session.post)).toEqual([
      SEARCH_ACTION,
      NEW_SEARCH_ACTION,
      SEARCH_ACTION,
    ]);
  });

  it('skips new-search when a detail action already reopened the session', async () => {
    const session = {
      entryHtml: '',
      generation: 1,
      post: vi.fn().mockResolvedValue(results),
      reopen: vi.fn(async () => {}),
    };
    const search = makeSearcher(session);
    await search(criteria);

    session.generation = 2;
    await search({ ...criteria, subject: 'MATH' });

    expect(actions(session.post)).toEqual([SEARCH_ACTION, SEARCH_ACTION]);
  });

  it('propagates a second session reset', async () => {
    const session = {
      entryHtml: '',
      generation: 1,
      post: vi.fn(async (action: string) => {
        session.generation += 1;
        throw new SessionResetError(action);
      }),
      reopen: vi.fn(async () => {}),
    };

    await expect(makeSearcher(session)(criteria)).rejects.toBeInstanceOf(
      SessionResetError,
    );
    expect(session.post).toHaveBeenCalledTimes(2);
  });
});
