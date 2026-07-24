import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { api, ApiError } from '../src/lib/api.ts';

const TERMS = [{ id: 1, code: '2268', name: 'Fall 2026' }];

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('api client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });
  afterEach(() => vi.restoreAllMocks());

  it('fetches and caches successful responses', async () => {
    mockFetchOnce(200, TERMS);
    const res = await api.terms();
    expect(res).toEqual({ data: TERMS, stale: false });
    expect(localStorage.getItem('csufsched:api:/api/terms')).toBe(JSON.stringify(TERMS));
  });

  it('falls back to cache when fetch rejects', async () => {
    localStorage.setItem('csufsched:api:/api/terms', JSON.stringify(TERMS));
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))));
    const res = await api.terms();
    expect(res).toEqual({ data: TERMS, stale: true });
  });

  it('falls back to cache on 5xx', async () => {
    localStorage.setItem('csufsched:api:/api/terms', JSON.stringify(TERMS));
    mockFetchOnce(500, { error: 'internal_error', message: 'boom' });
    const res = await api.terms();
    expect(res.stale).toBe(true);
  });

  it('rethrows when fetch fails and no cache exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))));
    try {
      await api.terms();
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
      expect((err as Error).message).toBe('network down');
    }
  });

  it('throws ApiError with server message on 404 without cache fallback', async () => {
    localStorage.setItem('csufsched:api:/api/professors/9', JSON.stringify({ id: 9 }));
    mockFetchOnce(404, { error: 'not_found', message: 'Unknown professor 9' });
    const err = await api.professor(9).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe('Unknown professor 9');
  });

  it('builds sections url from ids', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.sections([3, 1]);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/sections?ids=3,1');
  });
});
