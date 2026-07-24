import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { useScheduleStore, STORE_DEFAULTS } from '../src/store';
import { encodeShare } from '../src/lib/share';
import type { CourseWithSections, TermSummary } from '@csufsched/types';

const TERMS: TermSummary[] = [{ id: 7, code: '2268', name: 'Fall 2026' }];

const COURSE: CourseWithSections = {
  id: 1,
  deptCode: 'CPSC',
  catalogNbr: '121',
  title: 'Programming I',
  units: 3,
  sections: [
    {
      id: 11,
      courseId: 1,
      classNbr: '12345',
      sectionCode: '01',
      mode: 'in-person',
      enrollmentStatus: 'open',
      professor: null,
      meetings: [{ days: ['M', 'W'], startMin: 600, endMin: 675 }],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(routes: Record<string, unknown>, opts?: { failUnmatched?: boolean }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        if (body instanceof Response) return body;
        return jsonResponse(body);
      }
    }
    if (opts?.failUnmatched) throw new TypeError('network down');
    return jsonResponse({ error: 'not_found', message: 'nope' }, 404);
  });
}

beforeEach(() => {
  useScheduleStore.setState({ ...STORE_DEFAULTS });
  localStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('loads terms, selects first, shows footer freshness', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/api/terms': TERMS,
        '/api/meta': { dataFrom: '2026-07-20T12:00:00.000Z' },
      }),
    );
    render(<App />);
    await waitFor(() => expect(useScheduleStore.getState().termId).toBe(7));
    expect(screen.getByRole('combobox', { name: 'Term' })).toHaveValue('7');
    await waitFor(() => expect(screen.getByText(/Data from/)).toBeInTheDocument());
  });

  it('shows empty state when no terms exist', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/terms': [], '/api/meta': { dataFrom: null } }));
    render(<App />);
    await waitFor(() => expect(screen.getByText('No term data yet')).toBeInTheDocument());
  });

  it('shows offline banner when API unreachable but cache exists', async () => {
    localStorage.setItem('csufsched:api:/api/terms', JSON.stringify(TERMS));
    localStorage.setItem('csufsched:api:/api/meta', JSON.stringify({ dataFrom: null }));
    vi.stubGlobal('fetch', stubFetch({}, { failUnmatched: true }));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText('API unreachable — showing cached catalog.')).toBeInTheDocument(),
    );
  });

  it('hydrates schedule from share link hash', async () => {
    window.location.hash =
      '#s=' +
      encodeShare({
        termId: 7,
        sectionIds: [11],
        busyBlocks: [{ day: 'Tu', startMin: 540, endMin: 600 }],
      });
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/api/terms': TERMS,
        '/api/sections': [COURSE],
        '/api/meta': { dataFrom: null },
      }),
    );
    render(<App />);
    await waitFor(() => {
      const s = useScheduleStore.getState();
      expect(s.termId).toBe(7);
      expect(s.placedSectionIds).toEqual([11]);
      expect(s.busyBlocks).toEqual([{ day: 'Tu', startMin: 540, endMin: 600 }]);
    });
    expect(window.location.hash).toBe('');
  });

  it('stale share link shows old-semester message', async () => {
    window.location.hash =
      '#s=' + encodeShare({ termId: 99, sectionIds: [404], busyBlocks: [] });
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/api/terms': TERMS,
        '/api/sections': jsonResponse({ error: 'not_found', message: 'unknown section' }, 404),
        '/api/meta': { dataFrom: null },
      }),
    );
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByText('This schedule references an old semester.'),
      ).toBeInTheDocument(),
    );
  });
});
