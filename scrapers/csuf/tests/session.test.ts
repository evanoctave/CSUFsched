import { describe, it, expect, vi } from 'vitest';
import {
  openSession,
  isSessionExpired,
  DEFAULT_BASE_URL,
  SessionResetError,
} from '../src/session';

function entryHtml(icsid = 'ABC123=', stateNum = '1'): string {
  return `<html><form name='win0'>
    <input type='hidden' name='ICSID' id='ICSID' value='${icsid}' />
    <input type='hidden' name='ICStateNum' id='ICStateNum' value='${stateNum}' />
  </form></html>`;
}

function res(body: string, cookies: string[] = []): Response {
  const headers = new Headers();
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(body, { status: 200, headers });
}

function bodyOf(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ''));
}

describe('openSession', () => {
  it('GETs the entry page, extracts ICSID, and starts at state 1', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => res(entryHtml('SID=='), ['CFULPRD-PSJSESSIONID=abc; Path=/']));
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(DEFAULT_BASE_URL);
    expect(session.entryHtml).toContain('ICSID');
  });

  it('throws when the entry page carries no ICSID', async () => {
    const fetchFn = vi.fn(async () => res('<html>nope</html>'));
    await expect(openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn })).rejects.toThrow(/ICSID/);
  });
});

describe('session.post', () => {
  it('sends the envelope, ICSID, ICAction, extra fields, and the session cookie', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method !== 'POST'
        ? res(entryHtml('SID=='), ['CFULPRD-PSJSESSIONID=abc; Path=/; HttpOnly'])
        : res('<PAGE id="blank"></PAGE>'),
    );
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });
    await session.post('DO_THING', { A: 'b' });

    const init = fetchFn.mock.calls[1][1] as RequestInit | undefined;
    const body = bodyOf(init);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).cookie).toContain('CFULPRD-PSJSESSIONID=abc');
    expect(body.get('ICSID')).toBe('SID==');
    expect(body.get('ICAction')).toBe('DO_THING');
    expect(body.get('ICStateNum')).toBe('1');
    expect(body.get('ICAJAX')).toBe('1');
    expect(body.get('A')).toBe('b');
  });

  it('adopts the ICStateNum echoed by the response, and increments when absent', async () => {
    const replies = [
      res(entryHtml('SID==')),
      res(`<PAGE id='x'/><input id='ICStateNum' value='7' />`),
      res(`<PAGE id='x'/>`),
      res(`<PAGE id='x'/>`),
    ];
    let i = 0;
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => replies[i++]);
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });

    await session.post('A');
    await session.post('B');
    await session.post('C');

    const calls = fetchFn.mock.calls;
    expect(bodyOf(calls[1][1]).get('ICStateNum')).toBe('1');
    expect(bodyOf(calls[2][1]).get('ICStateNum')).toBe('7');
    expect(bodyOf(calls[3][1]).get('ICStateNum')).toBe('8');
  });

  it('reopens on expiry but never replays the stateful action', async () => {
    const replies = [
      res(entryHtml('OLD==')),
      res('<html>Your session has timed out.</html>'),
      res(entryHtml('NEW==')),
    ];
    let i = 0;
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => replies[i++]);
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });
    const initialGeneration = session.generation;

    await expect(session.post('#ICSave')).rejects.toBeInstanceOf(SessionResetError);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(session.generation).toBe(initialGeneration + 1);
  });

  it('starts generation at one after the initial open', async () => {
    const fetchFn = vi.fn(async () => res(entryHtml()));
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });
    expect(session.generation).toBe(1);
  });
});

describe('redirect handling', () => {
  it('follows a 302 and sends the cookie set on the redirect hop in the subsequent POST', async () => {
    const redirectHeaders = new Headers();
    redirectHeaders.set('location', DEFAULT_BASE_URL);
    redirectHeaders.append('set-cookie', 'AWSALB=hopvalue; Path=/');

    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => {
      const call = fetchFn.mock.calls.length;
      // call 1: GET → 302 with AWSALB cookie
      if (call === 1) return new Response(null, { status: 302, headers: redirectHeaders });
      // call 2: GET redirect destination → entry page
      if (call === 2) return res(entryHtml('SID=='));
      // call 3+: POST actions
      return res('<PAGE id="blank"></PAGE>');
    });

    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });
    await session.post('DO_THING');

    // The POST (call 3) must carry the AWSALB cookie that was only set on hop 1.
    const postInit = fetchFn.mock.calls[2][1] as RequestInit | undefined;
    expect((postInit?.headers as Record<string, string>).cookie).toContain('AWSALB=hopvalue');
  });

  it('resolves a relative Location against the request URL', async () => {
    const relativeLocation = '/psc/CFULPRD/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL?public=';
    const redirectHeaders = new Headers();
    redirectHeaders.set('location', relativeLocation);

    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => {
      const call = fetchFn.mock.calls.length;
      if (call === 1) return new Response(null, { status: 302, headers: redirectHeaders });
      return res(entryHtml());
    });

    await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });

    const expectedAbsolute = new URL(relativeLocation, DEFAULT_BASE_URL).href;
    expect(fetchFn.mock.calls[1][0]).toBe(expectedAbsolute);
  });

  it('rejects when the redirect chain exceeds 10 hops', async () => {
    const redirectHeaders = new Headers();
    redirectHeaders.set('location', DEFAULT_BASE_URL);

    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(null, { status: 302, headers: redirectHeaders }),
    );

    await expect(openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn })).rejects.toThrow(
      /too many redirects/i,
    );
  });
});

describe('isSessionExpired', () => {
  it('recognises the expiry wordings and the sign-on redirect', () => {
    expect(isSessionExpired('Your session has timed out.')).toBe(true);
    expect(isSessionExpired('Your session has expired')).toBe(true);
    expect(isSessionExpired('<a href="/psp/CFULPRD/?cmd=login">')).toBe(true);
    expect(isSessionExpired('<PAGE id="SSR_CLSRCH_RSLT">')).toBe(false);
  });
});
