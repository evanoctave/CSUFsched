import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';
import type { ApiQueries } from '../src/queries';

export function stubQueries(overrides: Partial<ApiQueries> = {}): ApiQueries {
  return {
    listTerms: async () => [],
    termExists: async () => false,
    listDepartments: async () => [],
    listCourses: async () => [],
    getProfessorDetail: async () => null,
    listSectionsByIds: async () => null,
    getMeta: async () => ({ dataFrom: null }),
    ...overrides,
  };
}

const OPTS = { corsOrigin: 'http://localhost:5173' };

describe('GET /api/terms', () => {
  it('returns terms with cache-control header', async () => {
    const app = await buildApp(
      stubQueries({ listTerms: async () => [{ id: 1, code: '2268', name: 'Fall 2026' }] }),
      OPTS,
    );
    const res = await app.inject({ method: 'GET', url: '/api/terms' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 1, code: '2268', name: 'Fall 2026' }]);
    expect(res.headers['cache-control']).toBe('public, max-age=7200');
  });

  it('reflects the locked CORS origin', async () => {
    const app = await buildApp(stubQueries(), OPTS);
    const res = await app.inject({
      method: 'GET',
      url: '/api/terms',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('GET /api/terms/:termId/departments', () => {
  it('404s with {error, message} for an unknown term', async () => {
    const app = await buildApp(stubQueries({ termExists: async () => false }), OPTS);
    const res = await app.inject({ method: 'GET', url: '/api/terms/42/departments' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: 'Unknown term 42' });
  });

  it('returns departments for a known term', async () => {
    const app = await buildApp(
      stubQueries({
        termExists: async () => true,
        listDepartments: async () => [{ id: 1, code: 'CPSC', name: 'Computer Science' }],
      }),
      OPTS,
    );
    const res = await app.inject({ method: 'GET', url: '/api/terms/1/departments' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 1, code: 'CPSC', name: 'Computer Science' }]);
  });

  it('404s for a non-numeric term id', async () => {
    const app = await buildApp(stubQueries({ termExists: async () => true }), OPTS);
    const res = await app.inject({ method: 'GET', url: '/api/terms/abc/departments' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/terms/:termId/courses', () => {
  it('400s when dept is missing', async () => {
    const app = await buildApp(stubQueries({ termExists: async () => true }), OPTS);
    const res = await app.inject({ method: 'GET', url: '/api/terms/1/courses' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'bad_request',
      message: 'dept query parameter is required',
    });
  });

  it('passes dept and q through to the query layer', async () => {
    let seen: unknown[] = [];
    const app = await buildApp(
      stubQueries({
        termExists: async () => true,
        listCourses: async (...args) => {
          seen = args;
          return [];
        },
      }),
      OPTS,
    );
    const res = await app.inject({ method: 'GET', url: '/api/terms/1/courses?dept=CPSC&q=121' });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual([1, 'CPSC', '121']);
  });

  it('defaults q to null when absent', async () => {
    let seen: unknown[] = [];
    const app = await buildApp(
      stubQueries({
        termExists: async () => true,
        listCourses: async (...args) => {
          seen = args;
          return [];
        },
      }),
      OPTS,
    );
    await app.inject({ method: 'GET', url: '/api/terms/1/courses?dept=CPSC' });
    expect(seen).toEqual([1, 'CPSC', null]);
  });

  it('404s for an unknown term before consulting courses', async () => {
    const app = await buildApp(stubQueries({ termExists: async () => false }), OPTS);
    const res = await app.inject({ method: 'GET', url: '/api/terms/9/courses?dept=CPSC' });
    expect(res.statusCode).toBe(404);
  });
});

describe('error shape', () => {
  it('unknown routes 404 with {error, message}', async () => {
    const app = await buildApp(stubQueries(), OPTS);
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: 'Route not found' });
  });

  it('query-layer failures surface as 500 {error, message}', async () => {
    const app = await buildApp(
      stubQueries({
        listTerms: async () => {
          throw new Error('db exploded');
        },
      }),
      OPTS,
    );
    const res = await app.inject({ method: 'GET', url: '/api/terms' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error', message: 'db exploded' });
  });
});

describe('GET /api/professors/:id', () => {
  const detail = {
    id: 7,
    fullName: 'Lee,J',
    rating: 4.2,
    difficulty: 2.1,
    wouldTakeAgainPct: 78,
    numRatings: 55,
    rmpUrl: 'https://www.ratemyprofessors.com/professor/1',
    tags: [{ tag: 'clear lectures', count: 12 }],
  };

  it('returns professor detail', async () => {
    const app = await buildApp(stubQueries({ getProfessorDetail: async () => detail }), OPTS);
    const res = await app.inject({ method: 'GET', url: '/api/professors/7' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(detail);
  });

  it('404s for unknown or non-numeric ids', async () => {
    const app = await buildApp(stubQueries({ getProfessorDetail: async () => null }), OPTS);
    const missing = await app.inject({ method: 'GET', url: '/api/professors/999' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found', message: 'Unknown professor 999' });
    const bad = await app.inject({ method: 'GET', url: '/api/professors/abc' });
    expect(bad.statusCode).toBe(404);
  });
});

describe('GET /api/sections', () => {
  it('400s when ids is missing or malformed', async () => {
    const app = await buildApp(stubQueries(), OPTS);
    const missing = await app.inject({ method: 'GET', url: '/api/sections' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({
      error: 'bad_request',
      message: 'ids query parameter is required, e.g. ids=1,2,3',
    });
    const malformed = await app.inject({ method: 'GET', url: '/api/sections?ids=1,x,3' });
    expect(malformed.statusCode).toBe(400);
    const empty = await app.inject({ method: 'GET', url: '/api/sections?ids=' });
    expect(empty.statusCode).toBe(400);
  });

  it('passes deduplicated numeric ids to the query layer', async () => {
    let seen: number[] = [];
    const app = await buildApp(
      stubQueries({
        listSectionsByIds: async (ids) => {
          seen = ids;
          return [];
        },
      }),
      OPTS,
    );
    const res = await app.inject({ method: 'GET', url: '/api/sections?ids=3,1,3' });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual([3, 1]);
  });

  it('404s when any requested section is unknown', async () => {
    const app = await buildApp(stubQueries({ listSectionsByIds: async () => null }), OPTS);
    const res = await app.inject({ method: 'GET', url: '/api/sections?ids=1,2' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: 'not_found',
      message: 'One or more sections not found',
    });
  });
});

describe('GET /api/meta', () => {
  it('returns dataFrom', async () => {
    const app = await buildApp(
      stubQueries({ getMeta: async () => ({ dataFrom: '2026-07-20T12:00:00.000Z' }) }),
      OPTS,
    );
    const res = await app.inject({ method: 'GET', url: '/api/meta' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dataFrom: '2026-07-20T12:00:00.000Z' });
  });
});

describe('rate limiting', () => {
  it('429s with {error, message} beyond the limit', async () => {
    const app = await buildApp(stubQueries(), { ...OPTS, rateLimitMax: 2 });
    await app.inject({ method: 'GET', url: '/api/terms' });
    await app.inject({ method: 'GET', url: '/api/terms' });
    const res = await app.inject({ method: 'GET', url: '/api/terms' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      error: 'rate_limited',
      message: 'Too many requests, slow down',
    });
  });
});
