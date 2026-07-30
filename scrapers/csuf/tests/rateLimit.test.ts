import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimited, fetchWithBackoff } from '../src/rateLimit';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimited', () => {
  it('spaces calls by at least the minimum interval', async () => {
    const calls: number[] = [];
    const fn = rateLimited(async () => {
      calls.push(Date.now());
    }, 1000);

    const p1 = fn();
    const p2 = fn();
    const p3 = fn();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(3);
    await Promise.all([p1, p2, p3]);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(1000);
    expect(calls[2] - calls[1]).toBeGreaterThanOrEqual(1000);
  });
});

describe('fetchWithBackoff', () => {
  it('returns immediately on ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const res = await fetchWithBackoff('https://x.test/a', mockFetch, { retries: 3, baseDelayMs: 100 });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries with exponential delay on 429/5xx, then succeeds', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const promise = fetchWithBackoff('https://x.test/a', mockFetch, { retries: 3, baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100); // after 1st failure
    await vi.advanceTimersByTimeAsync(200); // after 2nd failure
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
    const promise = fetchWithBackoff('https://x.test/a', mockFetch, { retries: 2, baseDelayMs: 100 });
    const assertion = expect(promise).rejects.toThrow(/503/);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('hands 3xx back to the caller instead of throwing', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('', { status: 302, headers: { location: '/elsewhere' } }),
    );
    const res = await fetchWithBackoff('https://x.test/a', mockFetch, { retries: 3, baseDelayMs: 100 });
    expect(res.status).toBe(302);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry 4xx other than 429', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('gone', { status: 404 }));
    await expect(
      fetchWithBackoff('https://x.test/a', mockFetch, { retries: 3, baseDelayMs: 100 }),
    ).rejects.toThrow(/404/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithBackoff init forwarding', () => {
  it('passes the init through to fetch on every attempt', async () => {
    const seen: Array<RequestInit | undefined> = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(init);
      return new Response('ok', { status: seen.length === 1 ? 500 : 200 });
    });
    const init: RequestInit = { method: 'POST', body: 'a=1' };

    const promise = fetchWithBackoff('http://x', fetchFn, { retries: 2, baseDelayMs: 1 }, init);
    await vi.advanceTimersByTimeAsync(1);

    const res = await promise;

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(init);
    expect(seen[1]).toBe(init);
  });
});
