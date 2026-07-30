# CSUF Class Search Scraper — Plan 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@csufsched/scraper-csuf`'s placeholder JSON transport with a real PeopleSoft Class Search scraper (HTTP + HTML parse), persisted transactionally so section ids survive re-scrapes and Plan 4 share links keep working.

**Architecture:** One PeopleSoft session object owns cookies, `ICSID`, and `ICStateNum`; pure parsers turn each page into data; `run.ts` orchestrates term × subject × career searches, one detail page per course for units, a sanity gate, and a single-transaction upsert-and-prune. The existing `parseClassRows` pipeline, `RawClassRow` contract, and Postgres schema are untouched.

**Tech Stack:** TypeScript strict, Node 22.6+ global `fetch` (local machine runs v24), Vitest, `pg` ^8. No HTML library — PeopleSoft emits stable, unique element ids (`MTG_DAYTIME$7`), so id-anchored regex extraction over document order is deterministic and keeps the package dependency-free.

**Environment notes (apply to every task):**
- pnpm is NOT on PATH. Run every pnpm command from the repo root as `npx pnpm ...`.
- Packages are consumed from source (`main` → `src/index.ts`), no build step.
- Run scraper tests as `npx pnpm --filter @csufsched/scraper-csuf test`, db tests as `npx pnpm --filter @csufsched/db test`.
- DB integration tests wrap in `describe.skipIf(!process.env.TEST_DATABASE_URL)`.
- `@csufsched/types` `Day` union is `'M' | 'Tu' | 'W' | 'Th' | 'F' | 'Sa' | 'Su'`.

## Verified transport (reconnaissance re-run 2026-07-29)

Base URL: `https://cmsweb.fullerton.edu/psc/CFULPRD/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL?public=`

The design doc's recipe is correct but **incomplete**. Two navigation actions it omits are mandatory, confirmed by live runs:

| Action | When | Result |
| --- | --- | --- |
| `CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH` | from the search entry page | warning page or results |
| `#ICSave` + `ICSaveWarningFilter=1` | when the response contains `SSR_SS_WARNING` | results |
| `MTG_CLASS_NBR$N` | from a results page, N = 0-based row index | that section's detail page (`SSR_CLSRCH_DTL`) |
| `CLASS_SRCH_WRK2_SSR_PB_BACK` | from a detail page ("View Search Results") | back to the same results page |
| `CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH$3$` | from a results page, before the next search | back to a usable entry page |

Skipping `NEW_SEARCH` makes every subsequent search silently return the *previous* subject's results. Skipping `BACK` (or using `DERIVED_REGFRM1_STEP3`, which does **not** work from a detail page) wedges the session on the detail page. Both were observed.

`ICStateNum` starts at 1 and increments per POST; responses often carry `id='ICStateNum' value='N'`, so parse it when present and increment otherwise. `ICSID` is constant per session.

**Markup landmarks** (all confirmed against Fall 2026 `2267`):

- Entry page dropdowns: `<select name='CLASS_SRCH_WRK2_STRM$35$'>` (terms: `2267` Fall 2026, `2265` Summer 2026), `SSR_CLSRCH_WRK_SUBJECT_SRCH$0` (92 options, first is blank), `SSR_CLSRCH_WRK_ACAD_CAREER$2` (`EXED`, `PBAC`, `UGRD`). Options use double-quoted values: `<option value="CPSC">Computer Science</option>`.
- Page identity: `setAttribute('Page', 'SSR_CLSRCH_RSLT')` for results, `SSR_SS_WARNING` for the over-50 interstitial, `SSR_CLSRCH_DTL` for detail, `SSR_CLSRCH_ENTRY` for the entry page (also returned when a search matches nothing).
- Course group headers: `title='Collapse section CPSC 120A - Introduction to Programming Lecture'`. Rows belong to the nearest preceding group header in document order.
- Per row `$N`: `<a name='MTG_CLASS_NBR$N' ...>18355</a>`, `<span ... id='MTG_CLASSNAME$N'>01-LEC<br />\nRegular</a>`, `MTG_DAYTIME$N` (`MoWe 8:30AM - 9:20AM` or `Asynchronous`), `MTG_ROOM$N` (`E 202 - Lecture Room`, `TBA`, `Online`), `FUL_STU_SS_WRK_LONGVALUE$N` (`In Person`, `Fully Online`, `Mostly Online w/ In-Person Mtg`), `MTG_INSTR$N`, and `win0divDERIVED_CLSRCH_SSR_STATUS_LONG$N` containing `<img ... alt="Open">` (also `Closed`, `Wait List`).
- Detail page units: `<span ... id='SSR_CLS_DTL_WRK_UNITS_RANGE'>2 units</span>` (ranges render as `1 - 3 units`).
- Verification run: CPSC / 2267 / UGRD → 42 course groups, 179 rows, 1.58 MB. HIST/UGRD → 105 rows. ART/PBAC → 89 rows. AFAM/EXED → 0 rows (entry page, no error text).

**Cost correction:** each detail fetch requires a `BACK` that re-downloads the full results page (~1.5 MB). At ~1,300 courses that is ~2,600 extra requests, so a nightly full run is roughly 1.5 hours at 1 req/s, not 40 minutes.

## File structure

```
scrapers/csuf/
  package.json                     + scripts: scrape:full, scrape:status, record-fixtures
  scripts/record-fixtures.ts       re-captures every fixture from the live site
  src/types.ts                     + Catalog, SearchCriteria, ResultRow, PersistInput
  src/rateLimit.ts                 fetchWithBackoff gains an optional RequestInit
  src/forms.ts                     NEW  envelope + search criteria field builder
  src/session.ts                   NEW  cookie jar, ICSID, ICStateNum, expiry retry
  src/catalog.ts                   NEW  entry-page dropdowns -> Catalog
  src/searchPage.ts                NEW  one search: POST, warning continue, reset
  src/parseResults.ts              NEW  results HTML -> ResultRow[]
  src/detail.ts                    NEW  detail page -> units string
  src/persist.ts                   NEW  single-transaction upsert + prune
  src/run.ts                       REWRITTEN orchestration + CLI
  src/statusRefresh.ts             NEW  hourly list-only status pass
  src/index.ts                     re-exports
  tests/fixtures/*.html            recorded, trimmed
  tests/{forms,session,catalog,parseResults,detail,searchPage,persist,run,statusRefresh}.test.ts
  tests/live.test.ts               opt-in behind LIVE_SCRAPE=1
db/
  src/upserts.ts                   Queryable widening, updateSectionStatuses, prune helpers
  src/index.ts                     new exports
  tests/upserts.test.ts            + prune / status-update / id-stability cases
docs/superpowers/specs/2026-07-28-csuf-scraper-design.md   amended with the two missing actions
```

---

### Task 1: Amend the design doc with the verified navigation actions

**Files:**
- Modify: `docs/superpowers/specs/2026-07-28-csuf-scraper-design.md:28-38`

- [ ] **Step 1: Replace the three-request recipe with the verified five-action one**

Find the block that begins "Three requests produce a full results page:" and ends with the
`ICStateNum` / `ICSID` paragraph. Replace the whole block with:

```markdown
Five actions produce and re-produce results pages within one session:

1. **GET** the URL above. Yields a `CFULPRD-PSJSESSIONID` cookie, `ICSID` (a base64 token,
   constant for the session), and `ICStateNum=1`.
2. **POST** the search with `ICAction=CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH`.
3. **POST** with `ICAction=#ICSave`, `ICSaveWarningFilter=1` to clear the "Your search will
   return over 50 classes, would you like to continue?" interstitial (page id
   `SSR_SS_WARNING`). Returns page id `SSR_CLSRCH_RSLT`.
4. **POST** `ICAction=CLASS_SRCH_WRK2_SSR_PB_BACK` ("View Search Results") to return to the
   results page after a detail fetch. `DERIVED_REGFRM1_STEP3` does not work from a detail
   page and wedges the session.
5. **POST** `ICAction=CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH$3$` before the next search. Without
   it, subsequent searches silently return the previous subject's results.

`ICStateNum` increments on every POST and is echoed back as
`id='ICStateNum' value='N'` on most responses; `ICSID` stays fixed for the session. A
verification run for CPSC / Fall 2026 / Undergraduate returned 179 sections in ~1.5MB of HTML.
```

- [ ] **Step 2: Correct the runtime estimate**

Find the sentence "At one request per second, a full run takes roughly 40 minutes." and
replace it with:

```markdown
Each detail fetch needs a `BACK` that re-downloads the full results page, so the detail pass
costs ~2,600 requests rather than ~1,300. At one request per second a full run takes roughly
1.5 hours.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-28-csuf-scraper-design.md
git commit -m "docs: correct scraper design with verified PeopleSoft navigation actions"
```

---

### Task 2: Field builder (`forms.ts`)

**Files:**
- Create: `scrapers/csuf/src/forms.ts`
- Modify: `scrapers/csuf/src/types.ts` (append `SearchCriteria`)
- Test: `scrapers/csuf/tests/forms.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scrapers/csuf/tests/forms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ENVELOPE_FIELDS, buildSearchFields } from '../src/forms';

describe('buildSearchFields', () => {
  const criteria = { termCode: '2267', subject: 'CPSC', career: 'UGRD' };

  it('sends institution, term, subject, career and the catalog-number floor', () => {
    const f = buildSearchFields(criteria);
    expect(f['CLASS_SRCH_WRK2_INSTITUTION$31$']).toBe('FLCMP');
    expect(f['CLASS_SRCH_WRK2_STRM$35$']).toBe('2267');
    expect(f['SSR_CLSRCH_WRK_SUBJECT_SRCH$0']).toBe('CPSC');
    expect(f['SSR_CLSRCH_WRK_ACAD_CAREER$2']).toBe('UGRD');
    expect(f['SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1']).toBe('G');
    expect(f['SSR_CLSRCH_WRK_CATALOG_NBR$1']).toBe('0');
    expect(f['SSR_CLSRCH_WRK_SSR_OPEN_ONLY$3']).toBe('N');
  });

  it('includes the empty-but-required companion fields', () => {
    const f = buildSearchFields(criteria);
    for (const k of [
      'SSR_CLSRCH_WRK_CRSE_ATTR$4',
      'SSR_CLSRCH_WRK_CRSE_ATTR_VALUE$4',
      'SSR_CLSRCH_WRK_LOCATION$5',
      'SSR_CLSRCH_WRK_DESCR$6',
    ]) {
      expect(f[k]).toBe('');
    }
  });

  it('does not carry PeopleSoft envelope fields (session owns those)', () => {
    expect(buildSearchFields(criteria)).not.toHaveProperty('ICAJAX');
    expect(ENVELOPE_FIELDS.ICAJAX).toBe('1');
    expect(ENVELOPE_FIELDS.ICType).toBe('Panel');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- forms`
Expected: FAIL, "Cannot find module '../src/forms'".

- [ ] **Step 3: Add `SearchCriteria` to `types.ts`**

Append to `scrapers/csuf/src/types.ts`:

```ts
export interface SearchCriteria {
  termCode: string;
  subject: string;
  career: string;
}
```

- [ ] **Step 4: Write `forms.ts`**

```ts
import type { SearchCriteria } from './types.ts';

export const ENVELOPE_FIELDS: Record<string, string> = {
  ICAJAX: '1',
  ICNAVTYPEDROPDOWN: '0',
  ICType: 'Panel',
  ICElementNum: '0',
  ICXPos: '0',
  ICYPos: '0',
  ResponsetoDiffFrame: '-1',
  TargetFrameName: 'None',
  FacetPath: 'None',
  ICFocus: '',
  ICChanged: '-1',
  ICSkipPending: '0',
  ICAutoSave: '0',
  ICResubmit: '0',
  ICActionPrompt: 'false',
  ICBcDomData: '',
  ICFind: '',
  ICAddCount: '',
  ICAppClsData: '',
};

// PeopleSoft rejects a search with fewer than two criteria, so subject always
// travels with the catalog-number floor.
export function buildSearchFields(c: SearchCriteria): Record<string, string> {
  return {
    'CLASS_SRCH_WRK2_INSTITUTION$31$': 'FLCMP',
    'CLASS_SRCH_WRK2_STRM$35$': c.termCode,
    'SSR_CLSRCH_WRK_SUBJECT_SRCH$0': c.subject,
    'SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1': 'G',
    'SSR_CLSRCH_WRK_CATALOG_NBR$1': '0',
    'SSR_CLSRCH_WRK_ACAD_CAREER$2': c.career,
    'SSR_CLSRCH_WRK_SSR_OPEN_ONLY$3': 'N',
    'SSR_CLSRCH_WRK_CRSE_ATTR$4': '',
    'SSR_CLSRCH_WRK_CRSE_ATTR_VALUE$4': '',
    'SSR_CLSRCH_WRK_LOCATION$5': '',
    'SSR_CLSRCH_WRK_DESCR$6': '',
  };
}
```

- [ ] **Step 5: Run the test**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- forms`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/forms.ts scrapers/csuf/src/types.ts scrapers/csuf/tests/forms.test.ts
git commit -m "feat(scraper): add PeopleSoft search form field builder"
```

---

### Task 3: `fetchWithBackoff` accepts a request init

**Files:**
- Modify: `scrapers/csuf/src/rateLimit.ts:24-40`
- Test: `scrapers/csuf/tests/rateLimit.test.ts` (append)

The session POSTs bodies and cookie headers, so the retry helper must forward an init.

- [ ] **Step 1: Write the failing test**

Append to `scrapers/csuf/tests/rateLimit.test.ts`:

```ts
describe('fetchWithBackoff init forwarding', () => {
  it('passes the init through to fetch on every attempt', async () => {
    const seen: Array<RequestInit | undefined> = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(init);
      return new Response('ok', { status: seen.length === 1 ? 500 : 200 });
    });
    const init: RequestInit = { method: 'POST', body: 'a=1' };

    const res = await fetchWithBackoff('http://x', fetchFn, { retries: 2, baseDelayMs: 1 }, init);

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(init);
    expect(seen[1]).toBe(init);
  });
});
```

If `describe`, `it`, `expect`, or `vi` are not already imported at the top of that file, add
them: `import { describe, it, expect, vi } from 'vitest';`

- [ ] **Step 2: Run it and watch it fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- rateLimit`
Expected: FAIL — `seen[0]` is `undefined`, since the current signature drops the init.

- [ ] **Step 3: Forward the init**

In `scrapers/csuf/src/rateLimit.ts`, change the signature and the call:

```ts
export async function fetchWithBackoff(
  url: string,
  fetchFn: FetchLike,
  opts: BackoffOptions,
  init?: RequestInit,
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const res = await fetchFn(url, init);
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= opts.retries) {
      throw new Error(`fetch failed: ${res.status} ${url}`);
    }
    await sleep(opts.baseDelayMs * 2 ** attempt);
    attempt += 1;
  }
}
```

- [ ] **Step 4: Run the whole scraper suite**

Run: `npx pnpm --filter @csufsched/scraper-csuf test`
Expected: PASS, including the pre-existing rateLimit and parse tests.

- [ ] **Step 5: Commit**

```bash
git add scrapers/csuf/src/rateLimit.ts scrapers/csuf/tests/rateLimit.test.ts
git commit -m "feat(scraper): forward request init through fetchWithBackoff"
```

---

### Task 4: PeopleSoft session (`session.ts`)

**Files:**
- Create: `scrapers/csuf/src/session.ts`
- Test: `scrapers/csuf/tests/session.test.ts`

The session is the only module that knows about cookies, `ICSID`, and `ICStateNum`.

- [ ] **Step 1: Write the failing test**

Create `scrapers/csuf/tests/session.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { openSession, isSessionExpired, DEFAULT_BASE_URL } from '../src/session';

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
    const fetchFn = vi.fn(async () => res(entryHtml('SID=='), ['CFULPRD-PSJSESSIONID=abc; Path=/']));
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
      init === undefined
        ? res(entryHtml('SID=='), ['CFULPRD-PSJSESSIONID=abc; Path=/; HttpOnly'])
        : res('<PAGE id="blank"></PAGE>'),
    );
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });
    await session.post('DO_THING', { A: 'b' });

    const init = fetchFn.mock.calls[1][1];
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
    const fetchFn = vi.fn(async () => replies[i++]);
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });

    await session.post('A');
    await session.post('B');
    await session.post('C');

    expect(bodyOf(fetchFn.mock.calls[1][1]).get('ICStateNum')).toBe('1');
    expect(bodyOf(fetchFn.mock.calls[2][1]).get('ICStateNum')).toBe('7');
    expect(bodyOf(fetchFn.mock.calls[3][1]).get('ICStateNum')).toBe('8');
  });

  it('reopens the session once and retries when the response is an expiry page', async () => {
    const replies = [
      res(entryHtml('OLD==')),
      res('<html>Your session has timed out.</html>'),
      res(entryHtml('NEW==')),
      res('<PAGE id="blank">good</PAGE>'),
    ];
    let i = 0;
    const fetchFn = vi.fn(async () => replies[i++]);
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });

    const html = await session.post('DO_THING');

    expect(html).toContain('good');
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(bodyOf(fetchFn.mock.calls[3][1]).get('ICSID')).toBe('NEW==');
  });

  it('throws when the retry after a reopen also expires', async () => {
    const expired = 'Your session has expired.';
    const replies = [res(entryHtml()), res(expired), res(entryHtml()), res(expired)];
    let i = 0;
    const fetchFn = vi.fn(async () => replies[i++]);
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn });

    await expect(session.post('DO_THING')).rejects.toThrow(/session expired/i);
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- session`
Expected: FAIL, "Cannot find module '../src/session'".

- [ ] **Step 3: Write `session.ts`**

```ts
import { ENVELOPE_FIELDS } from './forms.ts';
import type { FetchLike } from './rateLimit.ts';

export const DEFAULT_BASE_URL =
  'https://cmsweb.fullerton.edu/psc/CFULPRD/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL?public=';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36';

export interface SessionOptions {
  baseUrl: string;
  fetchFn: FetchLike;
}

export interface PeopleSoftSession {
  readonly entryHtml: string;
  post(action: string, fields?: Record<string, string>): Promise<string>;
}

export function isSessionExpired(html: string): boolean {
  return (
    /your session (has (timed out|expired)|is no longer active)/i.test(html) ||
    html.includes('cmd=login') ||
    html.includes('signon.html')
  );
}

function readHiddenField(html: string, name: string): string | null {
  const m = new RegExp(`id='${name}'\\s+value='([^']*)'`).exec(html);
  return m ? m[1] : null;
}

class CookieJar {
  private jar = new Map<string, string>();

  ingest(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

class Session implements PeopleSoftSession {
  entryHtml = '';
  private icsid = '';
  private stateNum = 1;
  private jar = new CookieJar();

  constructor(private readonly opts: SessionOptions) {}

  async open(): Promise<void> {
    const res = await this.opts.fetchFn(this.opts.baseUrl);
    const html = await res.text();
    this.jar.ingest(res);
    const icsid = readHiddenField(html, 'ICSID');
    if (icsid === null) throw new Error('entry page carried no ICSID');
    this.icsid = icsid;
    this.stateNum = Number(readHiddenField(html, 'ICStateNum') ?? '1');
    this.entryHtml = html;
  }

  async post(action: string, fields: Record<string, string> = {}): Promise<string> {
    const html = await this.send(action, fields);
    if (!isSessionExpired(html)) return html;

    await this.open();
    const retry = await this.send(action, fields);
    if (isSessionExpired(retry)) throw new Error(`session expired twice on action ${action}`);
    return retry;
  }

  private async send(action: string, fields: Record<string, string>): Promise<string> {
    const body = new URLSearchParams({
      ...ENVELOPE_FIELDS,
      ICSID: this.icsid,
      ICStateNum: String(this.stateNum),
      ICAction: action,
      ...fields,
    });
    const res = await this.opts.fetchFn(this.opts.baseUrl, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: this.jar.header(),
        'user-agent': USER_AGENT,
      },
    });
    const html = await res.text();
    this.jar.ingest(res);
    const echoed = readHiddenField(html, 'ICStateNum');
    this.stateNum = echoed === null ? this.stateNum + 1 : Number(echoed);
    return html;
  }
}

export async function openSession(opts: SessionOptions): Promise<PeopleSoftSession> {
  const session = new Session(opts);
  await session.open();
  return session;
}
```

- [ ] **Step 4: Run the test**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- session`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

Run: `npx pnpm --filter @csufsched/scraper-csuf typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/session.ts scrapers/csuf/tests/session.test.ts
git commit -m "feat(scraper): add PeopleSoft session with cookie jar and expiry retry"
```

---

### Task 5: Fixture recorder + recorded fixtures

**Files:**
- Create: `scrapers/csuf/scripts/record-fixtures.ts`
- Create (generated): `scrapers/csuf/tests/fixtures/entry.html`, `warning.html`, `results-cpsc.html`, `results-online.html`, `no-results.html`, `detail.html`
- Create (hand-written): `scrapers/csuf/tests/fixtures/expired.html`
- Modify: `scrapers/csuf/package.json` (add the `record-fixtures` script)

Every later parser task tests against these files, so record them before writing parsers.
The recorder trims results pages by cutting at the Nth course-group header — parsers are
id-anchored, so a truncated page parses exactly like a short one.

- [ ] **Step 1: Write the recorder**

Create `scrapers/csuf/scripts/record-fixtures.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession, DEFAULT_BASE_URL } from '../src/session.ts';
import { buildSearchFields } from '../src/forms.ts';
import { rateLimited, fetchWithBackoff } from '../src/rateLimit.ts';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const SEARCH = 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH';
const CONTINUE = '#ICSave';
const NEW_SEARCH = 'CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH$3$';
const BACK = 'CLASS_SRCH_WRK2_SSR_PB_BACK';

function trimToGroups(html: string, groups: number): string {
  const marker = /title='Collapse section /g;
  let cut = -1;
  for (let i = 0; i <= groups; i += 1) {
    const m = marker.exec(html);
    if (m === null) return html;
    cut = m.index;
  }
  return `${html.slice(0, cut)}\n<!-- fixture truncated after ${groups} course groups -->\n`;
}

const limited = rateLimited(
  (url: string, init?: RequestInit) => fetchWithBackoff(url, fetch, { retries: 3, baseDelayMs: 1000 }, init),
  1000,
);

const run = async (): Promise<void> => {
  await fs.mkdir(OUT, { recursive: true });
  const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn: limited });
  await fs.writeFile(path.join(OUT, 'entry.html'), session.entryHtml);

  const termCode = process.env.FIXTURE_TERM ?? '2267';

  const warning = await session.post(SEARCH, buildSearchFields({ termCode, subject: 'CPSC', career: 'UGRD' }));
  await fs.writeFile(path.join(OUT, 'warning.html'), warning);

  const cpsc = await session.post(CONTINUE, { ICSaveWarningFilter: '1' });
  await fs.writeFile(path.join(OUT, 'results-cpsc.html'), trimToGroups(cpsc, 3));

  const detail = await session.post('MTG_CLASS_NBR$0');
  await fs.writeFile(path.join(OUT, 'detail.html'), detail);
  await session.post(BACK);

  await session.post(NEW_SEARCH);
  const histWarning = await session.post(SEARCH, buildSearchFields({ termCode, subject: 'HIST', career: 'UGRD' }));
  const hist = histWarning.includes('SSR_SS_WARNING')
    ? await session.post(CONTINUE, { ICSaveWarningFilter: '1' })
    : histWarning;
  await fs.writeFile(path.join(OUT, 'results-online.html'), trimToGroups(hist, 2));

  await session.post(NEW_SEARCH);
  const empty = await session.post(SEARCH, buildSearchFields({ termCode, subject: 'AFAM', career: 'EXED' }));
  await fs.writeFile(path.join(OUT, 'no-results.html'), empty);

  console.log(`fixtures written to ${OUT}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to `scrapers/csuf/package.json`**

In the `"scripts"` block, alongside the existing entries:

```json
"record-fixtures": "node --experimental-strip-types scripts/record-fixtures.ts"
```

- [ ] **Step 3: Record the fixtures against the live site**

Run: `npx pnpm --filter @csufsched/scraper-csuf record-fixtures`
Expected: prints `fixtures written to .../tests/fixtures`.

Verify the shapes before trusting them:

```bash
ls -la scrapers/csuf/tests/fixtures
grep -c "id='MTG_CLASS_NBR\$" scrapers/csuf/tests/fixtures/results-cpsc.html
grep -o "SSR_SS_WARNING" scrapers/csuf/tests/fixtures/warning.html | head -1
grep -o "SSR_CLS_DTL_WRK_UNITS_RANGE'[^>]*>[^<]*" scrapers/csuf/tests/fixtures/detail.html
grep -c "id='MTG_CLASS_NBR\$" scrapers/csuf/tests/fixtures/no-results.html || true
```

Expected: `results-cpsc.html` has 10–25 rows and is well under 300 KB; `warning.html`
contains `SSR_SS_WARNING`; `detail.html` shows something like `>2 units`; `no-results.html`
has zero rows. If `results-cpsc.html` is over 400 KB, lower the `trimToGroups(cpsc, 3)`
argument to `2` and re-record.

- [ ] **Step 4: Hand-write the expiry fixture**

Live expiry cannot be triggered on demand, so create
`scrapers/csuf/tests/fixtures/expired.html` with the minimum the detector keys on:

```html
<html><body>
<p>Your session has timed out. Please sign in again.</p>
<a href="/psp/CFULPRD/?cmd=login">Sign in</a>
</body></html>
```

- [ ] **Step 5: Commit**

```bash
git add scrapers/csuf/scripts/record-fixtures.ts scrapers/csuf/package.json scrapers/csuf/tests/fixtures
git commit -m "test(scraper): record trimmed CSUF class search fixtures"
```

---

### Task 6: Catalog parser (`catalog.ts`)

**Files:**
- Create: `scrapers/csuf/src/catalog.ts`
- Modify: `scrapers/csuf/src/types.ts` (append catalog types)
- Test: `scrapers/csuf/tests/catalog.test.ts`

This removes the hardcoded `DEPARTMENTS` env var and supplies real department names.

- [ ] **Step 1: Write the failing test**

Create `scrapers/csuf/tests/catalog.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseCatalog } from '../src/catalog';

const fixture = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'entry.html'),
  'utf8',
);

describe('parseCatalog', () => {
  const catalog = parseCatalog(fixture);

  it('reads terms newest first, dropping the blank option', () => {
    expect(catalog.terms.length).toBeGreaterThanOrEqual(1);
    expect(catalog.terms.every((t) => t.code !== '')).toBe(true);
    expect(catalog.terms.map((t) => t.code)).toContain('2267');
    expect(catalog.terms.find((t) => t.code === '2267')?.name).toBe('Fall 2026');
  });

  it('reads all subjects with their real names', () => {
    expect(catalog.subjects.length).toBeGreaterThan(80);
    expect(catalog.subjects.find((s) => s.code === 'CPSC')?.name).toBe('Computer Science');
    expect(catalog.subjects.every((s) => s.code !== '' && s.name !== '')).toBe(true);
  });

  it('reads the three careers', () => {
    expect(catalog.careers.map((c) => c.code).sort()).toEqual(['EXED', 'PBAC', 'UGRD']);
  });

  it('decodes HTML entities in option labels', () => {
    const html = `<select name='SSR_CLSRCH_WRK_SUBJECT_SRCH$0'>
      <option value="">&nbsp;</option>
      <option value="ACCT">Accounting &amp; Finance</option>
    </select>`;
    expect(parseCatalog(html).subjects).toEqual([{ code: 'ACCT', name: 'Accounting & Finance' }]);
  });

  it('throws when a required dropdown is missing', () => {
    expect(() => parseCatalog('<html>nothing</html>')).toThrow(/CLASS_SRCH_WRK2_STRM/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- catalog`
Expected: FAIL, "Cannot find module '../src/catalog'".

- [ ] **Step 3: Append catalog types to `types.ts`**

```ts
export interface CatalogOption {
  code: string;
  name: string;
}

export interface Catalog {
  terms: CatalogOption[];
  subjects: CatalogOption[];
  careers: CatalogOption[];
}
```

- [ ] **Step 4: Write `catalog.ts`**

```ts
import type { Catalog, CatalogOption } from './types.ts';

const TERM_SELECT = 'CLASS_SRCH_WRK2_STRM$35$';
const SUBJECT_SELECT = 'SSR_CLSRCH_WRK_SUBJECT_SRCH$0';
const CAREER_SELECT = 'SSR_CLSRCH_WRK_ACAD_CAREER$2';

export function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function selectBody(html: string, name: string): string {
  const open = html.indexOf(`<select name='${name}'`);
  if (open === -1) throw new Error(`dropdown ${name} not found on entry page`);
  const close = html.indexOf('</select>', open);
  return html.slice(open, close);
}

function parseOptions(html: string, name: string): CatalogOption[] {
  const body = selectBody(html, name);
  const options: CatalogOption[] = [];
  for (const m of body.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)) {
    const code = m[1].trim();
    const label = decodeEntities(m[2]).trim();
    if (code === '' || label === '') continue;
    options.push({ code, name: label });
  }
  return options;
}

export function parseCatalog(html: string): Catalog {
  return {
    terms: parseOptions(html, TERM_SELECT),
    subjects: parseOptions(html, SUBJECT_SELECT),
    careers: parseOptions(html, CAREER_SELECT),
  };
}
```

- [ ] **Step 5: Run the test**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- catalog`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/catalog.ts scrapers/csuf/src/types.ts scrapers/csuf/tests/catalog.test.ts
git commit -m "feat(scraper): parse terms, subjects, and careers from the entry page"
```

---

### Task 7: Results parser (`parseResults.ts`)

**Files:**
- Create: `scrapers/csuf/src/parseResults.ts`
- Modify: `scrapers/csuf/src/types.ts` (append `ResultRow`)
- Test: `scrapers/csuf/tests/parseResults.test.ts`

Produces `RawClassRow`s with `units: ''`; Task 9 fills units from detail pages before
`parseClassRows` runs.

- [ ] **Step 1: Write the failing test**

Create `scrapers/csuf/tests/parseResults.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseResultRows, parseDayTime, parseRoom, parseMode, parseStatus } from '../src/parseResults';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const cpsc = fs.readFileSync(path.join(dir, 'results-cpsc.html'), 'utf8');
const online = fs.readFileSync(path.join(dir, 'results-online.html'), 'utf8');
const noResults = fs.readFileSync(path.join(dir, 'no-results.html'), 'utf8');

describe('parseDayTime', () => {
  it('splits a day-and-time string', () => {
    expect(parseDayTime('MoWe 8:30AM - 9:20AM')).toEqual({
      days: 'MoWe',
      start: '8:30AM',
      end: '9:20AM',
    });
  });

  it('treats Asynchronous, TBA, and blank as no meeting', () => {
    for (const raw of ['Asynchronous', 'TBA', '']) {
      expect(parseDayTime(raw)).toEqual({ days: '', start: '', end: '' });
    }
  });

  it('throws on an unrecognised shape', () => {
    expect(() => parseDayTime('MoWe 8:30AM')).toThrow(/day\/time/i);
  });
});

describe('parseRoom', () => {
  it('splits building from room and drops the room-type suffix', () => {
    expect(parseRoom('E 202 - Lecture Room')).toEqual({ building: 'E', room: '202' });
    expect(parseRoom('CPAC 148 - Lecture Room')).toEqual({ building: 'CPAC', room: '148' });
    expect(parseRoom('CS 102A - Lecture Room')).toEqual({ building: 'CS', room: '102A' });
  });

  it('treats Online, TBA, and blank as no room', () => {
    for (const raw of ['Online', 'TBA', '']) {
      expect(parseRoom(raw)).toEqual({ building: '', room: '' });
    }
  });
});

describe('parseMode', () => {
  it('maps the observed instruction modes to pipeline codes', () => {
    expect(parseMode('In Person')).toBe('P');
    expect(parseMode('Fully Online')).toBe('OL');
    expect(parseMode('Mostly Online w/ In-Person Mtg')).toBe('HY');
    expect(parseMode('Hybrid')).toBe('HY');
  });

  it('throws on an unknown mode so the row lands in rowsSkipped', () => {
    expect(() => parseMode('Teleportation')).toThrow(/instruction mode/i);
  });
});

describe('parseStatus', () => {
  it('maps the status icon alt text', () => {
    expect(parseStatus('Open')).toBe('O');
    expect(parseStatus('Closed')).toBe('C');
    expect(parseStatus('Wait List')).toBe('W');
  });
});

describe('parseResultRows', () => {
  it('returns one row per meeting row, carrying its results-page index', () => {
    const { rows, skipped } = parseResultRows(cpsc);
    expect(skipped).toHaveLength(0);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0].rowIndex).toBe(0);
    expect(rows.map((r) => r.rowIndex)).toEqual([...rows.map((r) => r.rowIndex)].sort((a, b) => a - b));
  });

  it('fills subject, catalog number, and title from the course group header', () => {
    const first = parseResultRows(cpsc).rows[0].row;
    expect(first.subject).toBe('CPSC');
    expect(first.catalog_nbr).toMatch(/^\d{3}[A-Z]?$/);
    expect(first.descr.length).toBeGreaterThan(3);
  });

  it('fills class number, section code, instructor, mode, and status', () => {
    const first = parseResultRows(cpsc).rows[0].row;
    expect(first.class_nbr).toMatch(/^\d+$/);
    expect(first.class_section).toMatch(/^\d+$/);
    expect(first.instruction_mode).toBe('P');
    expect(['O', 'C', 'W']).toContain(first.enrollment_status);
    expect(first.instructor.length).toBeGreaterThan(0);
  });

  it('leaves units empty for the detail pass to fill', () => {
    expect(parseResultRows(cpsc).rows.every((r) => r.row.units === '')).toBe(true);
  });

  it('reads asynchronous online rows as no days, no times, and no room', () => {
    const async = parseResultRows(online).rows.filter((r) => r.row.instruction_mode === 'OL');
    expect(async.length).toBeGreaterThan(0);
    expect(async[0].row.meeting_days).toBe('');
    expect(async[0].row.start_time).toBe('');
    expect(async[0].row.building).toBe('');
  });

  it('returns nothing for a page with no result rows', () => {
    expect(parseResultRows(noResults)).toEqual({ rows: [], skipped: [] });
  });

  it('records an unparseable row instead of throwing', () => {
    const broken = `
      <a class='PSHYPERLINK' title='Collapse section CPSC 999 - Broken'>x</a>
      <a name='MTG_CLASS_NBR$0' id='MTG_CLASS_NBR$0'>111</a>
      <span id='MTG_CLASSNAME$0'>01-LEC<br />Regular</span>
      <span id='MTG_DAYTIME$0'>whenever</span>
      <span id='MTG_ROOM$0'>TBA</span>
      <span id='FUL_STU_SS_WRK_LONGVALUE$0'>In Person</span>
      <span id='MTG_INSTR$0'>Staff</span>
      <div id='win0divDERIVED_CLSRCH_SSR_STATUS_LONG$0'><img alt="Open"></div>`;
    const { rows, skipped } = parseResultRows(broken);
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].rowIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- parseResults`
Expected: FAIL, "Cannot find module '../src/parseResults'".

- [ ] **Step 3: Append `ResultRow` to `types.ts`**

```ts
export interface ResultRow {
  rowIndex: number;
  row: RawClassRow;
}
```

- [ ] **Step 4: Write `parseResults.ts`**

```ts
import { decodeEntities } from './catalog.ts';
import type { RawClassRow, ResultRow } from './types.ts';

const NO_MEETING = new Set(['', 'TBA', 'Asynchronous']);
const NO_ROOM = new Set(['', 'TBA', 'Online']);

export function parseDayTime(raw: string): { days: string; start: string; end: string } {
  const value = raw.trim();
  if (NO_MEETING.has(value)) return { days: '', start: '', end: '' };
  const m = /^([A-Za-z]+)\s+(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)$/.exec(value);
  if (m === null) throw new Error(`unrecognized day/time "${raw}"`);
  return { days: m[1], start: m[2], end: m[3] };
}

export function parseRoom(raw: string): { building: string; room: string } {
  const value = raw.trim().split(' - ')[0].trim();
  if (NO_ROOM.has(value)) return { building: '', room: '' };
  const parts = value.split(/\s+/);
  if (parts.length < 2) return { building: '', room: value };
  return { building: parts.slice(0, -1).join(' '), room: parts[parts.length - 1] };
}

export function parseMode(raw: string): string {
  const value = raw.trim();
  const online = /online/i.test(value);
  const inPerson = /in[- ]person/i.test(value);
  if (/hybrid/i.test(value) || (online && inPerson)) return 'HY';
  if (online) return 'OL';
  if (inPerson) return 'P';
  throw new Error(`unknown instruction mode "${raw}"`);
}

export function parseStatus(alt: string): string {
  const value = alt.trim().toLowerCase();
  if (value === 'open') return 'O';
  if (value === 'closed') return 'C';
  if (value === 'wait list') return 'W';
  throw new Error(`unknown enrollment status "${alt}"`);
}

// MTG_CLASSNAME is an anchor, every other field is a span, so close on either.
function fieldText(html: string, id: string): string {
  const m = new RegExp(`id='${id.replace(/\$/g, '\\$')}'[^>]*>([\\s\\S]*?)</(?:span|a)>`).exec(html);
  if (m === null) throw new Error(`field ${id} not found`);
  return decodeEntities(m[1].replace(/<br\s*\/?>/gi, '\n')).trim();
}

function statusAlt(html: string, index: number): string {
  const anchor = html.indexOf(`id='win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${index}'`);
  if (anchor === -1) throw new Error(`status cell for row ${index} not found`);
  const m = /alt="([^"]*)"/.exec(html.slice(anchor, anchor + 800));
  if (m === null) throw new Error(`status icon for row ${index} not found`);
  return m[1];
}

interface CourseHeader {
  offset: number;
  subject: string;
  catalogNbr: string;
  title: string;
}

function courseHeaders(html: string): CourseHeader[] {
  const headers: CourseHeader[] = [];
  for (const m of html.matchAll(/title='Collapse section ([^']*)'/g)) {
    const label = decodeEntities(m[1]).trim();
    const parsed = /^(\S+)\s+(\S+)\s+-\s+([\s\S]+)$/.exec(label);
    if (parsed === null) continue;
    headers.push({
      offset: m.index ?? 0,
      subject: parsed[1],
      catalogNbr: parsed[2],
      title: parsed[3].trim(),
    });
  }
  return headers;
}

function headerFor(headers: CourseHeader[], offset: number): CourseHeader {
  let found: CourseHeader | undefined;
  for (const h of headers) {
    if (h.offset > offset) break;
    found = h;
  }
  if (found === undefined) throw new Error('row has no preceding course group header');
  return found;
}

export interface ResultParseResult {
  rows: ResultRow[];
  skipped: Array<{ rowIndex: number; error: string }>;
}

export function parseResultRows(html: string): ResultParseResult {
  const headers = courseHeaders(html);
  const rows: ResultRow[] = [];
  const skipped: ResultParseResult['skipped'] = [];

  for (const m of html.matchAll(/id='MTG_CLASS_NBR\$(\d+)'[^>]*>(\d+)<\/a>/g)) {
    const rowIndex = Number(m[1]);
    try {
      const header = headerFor(headers, m.index ?? 0);
      const { days, start, end } = parseDayTime(fieldText(html, `MTG_DAYTIME$${rowIndex}`));
      const { building, room } = parseRoom(fieldText(html, `MTG_ROOM$${rowIndex}`));
      const classname = fieldText(html, `MTG_CLASSNAME$${rowIndex}`);
      const row: RawClassRow = {
        subject: header.subject,
        catalog_nbr: header.catalogNbr,
        descr: header.title,
        units: '',
        class_nbr: m[2],
        class_section: classname.split('\n')[0].split('-')[0].trim(),
        instructor: fieldText(html, `MTG_INSTR$${rowIndex}`),
        meeting_days: days,
        start_time: start,
        end_time: end,
        building,
        room,
        instruction_mode: parseMode(fieldText(html, `FUL_STU_SS_WRK_LONGVALUE$${rowIndex}`)),
        enrollment_status: parseStatus(statusAlt(html, rowIndex)),
      };
      rows.push({ rowIndex, row });
    } catch (err) {
      skipped.push({ rowIndex, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { rows, skipped };
}
```

- [ ] **Step 5: Run the test**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- parseResults`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/parseResults.ts scrapers/csuf/src/types.ts scrapers/csuf/tests/parseResults.test.ts
git commit -m "feat(scraper): parse class search results HTML into raw class rows"
```

---

### Task 8: Detail page units (`detail.ts`)

**Files:**
- Create: `scrapers/csuf/src/detail.ts`
- Test: `scrapers/csuf/tests/detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scrapers/csuf/tests/detail.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { parseUnitsRange, detailAction, fetchUnits, DETAIL_BACK_ACTION } from '../src/detail';

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
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- detail`
Expected: FAIL, "Cannot find module '../src/detail'".

- [ ] **Step 3: Write `detail.ts`**

```ts
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
```

- [ ] **Step 4: Run the test**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- detail`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scrapers/csuf/src/detail.ts scrapers/csuf/tests/detail.test.ts
git commit -m "feat(scraper): fetch per-course units from the section detail page"
```

---

### Task 9: Search execution (`searchPage.ts`)

**Files:**
- Create: `scrapers/csuf/src/searchPage.ts`
- Test: `scrapers/csuf/tests/searchPage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scrapers/csuf/tests/searchPage.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- searchPage`
Expected: FAIL, "Cannot find module '../src/searchPage'".

- [ ] **Step 3: Write `searchPage.ts`**

```ts
import { buildSearchFields } from './forms.ts';
import type { PeopleSoftSession } from './session.ts';
import type { SearchCriteria } from './types.ts';

export const SEARCH_ACTION = 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH';
export const WARNING_CONTINUE_ACTION = '#ICSave';
export const NEW_SEARCH_ACTION = 'CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH$3$';

export function isWarningPage(html: string): boolean {
  return html.includes('SSR_SS_WARNING');
}

export function isResultsPage(html: string): boolean {
  return html.includes('SSR_CLSRCH_RSLT') && html.includes("id='MTG_CLASS_NBR$");
}

function isEmptyEntryPage(html: string): boolean {
  return html.includes('SSR_CLSRCH_ENTRY') && !html.includes("id='MTG_CLASS_NBR$");
}

// Returns null for a search that legitimately matched no classes — PeopleSoft
// answers those with the entry page and no message at all.
export async function runSearch(
  session: PeopleSoftSession,
  criteria: SearchCriteria,
): Promise<string | null> {
  let html = await session.post(SEARCH_ACTION, buildSearchFields(criteria));
  if (isWarningPage(html)) {
    html = await session.post(WARNING_CONTINUE_ACTION, { ICSaveWarningFilter: '1' });
  }
  if (isResultsPage(html)) return html;
  if (isEmptyEntryPage(html)) return null;
  throw new Error(
    `unexpected page for ${criteria.subject}/${criteria.career}/${criteria.termCode}`,
  );
}

// Mandatory between searches: without it PeopleSoft replays the previous results.
export async function resetSearch(session: PeopleSoftSession): Promise<void> {
  await session.post(NEW_SEARCH_ACTION);
}
```

- [ ] **Step 4: Run the test**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- searchPage`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the whole scraper suite and typecheck**

Run: `npx pnpm --filter @csufsched/scraper-csuf test && npx pnpm --filter @csufsched/scraper-csuf typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/searchPage.ts scrapers/csuf/tests/searchPage.test.ts
git commit -m "feat(scraper): execute one class search with warning auto-continue"
```

---

### Task 10: Widen the db layer (`Queryable`, prune, status updates)

**Files:**
- Modify: `db/src/upserts.ts`
- Modify: `db/src/index.ts`
- Test: `db/tests/upserts.test.ts` (append a new `describe` block)

Every write in a run must go through one client, so the upserts accept anything with a
`query` method. `replaceMeetings` loses its internal transaction — callers now own the
transaction boundary, which is what the all-or-nothing swap requires.

- [ ] **Step 1: Write the failing test**

Append to `db/tests/upserts.test.ts` (inside the existing integration `describe`, or as a new
`describe.skipIf(!TEST_URL)` block after it). Add the new functions to the import list at the
top of the file: `deleteCoursesNotIn`, `deleteSectionsNotIn`, `updateSectionStatuses`,
`countSectionsForTerm`.

```ts
describe.skipIf(!TEST_URL)('transactional swap', () => {
  it('keeps section ids stable across a re-scrape and prunes what vanished', async () => {
    const pool = createPool(TEST_URL!);
    try {
      const termId = await upsertTerm(pool, { code: '2299', name: 'Test Term' });
      const deptId = await upsertDepartment(pool, { code: 'ZTST', name: 'Test Dept' });
      const courseId = await upsertCourse(pool, {
        termId, deptId, catalogNbr: '101', title: 'Intro', units: 3, description: null,
      });
      const keptId = await upsertSection(pool, {
        courseId, classNbr: '10001', sectionCode: '01',
        instructorId: null, mode: 'in-person', enrollmentStatus: 'open',
      });
      const goneId = await upsertSection(pool, {
        courseId, classNbr: '10002', sectionCode: '02',
        instructorId: null, mode: 'in-person', enrollmentStatus: 'open',
      });

      const sameId = await upsertSection(pool, {
        courseId, classNbr: '10001', sectionCode: '01',
        instructorId: null, mode: 'in-person', enrollmentStatus: 'closed',
      });
      expect(sameId).toBe(keptId);

      const deleted = await deleteSectionsNotIn(pool, termId, [keptId]);
      expect(deleted).toBe(1);
      const rows = await pool.query('SELECT id FROM sections WHERE id = $1', [goneId]);
      expect(rows.rowCount).toBe(0);

      expect(await countSectionsForTerm(pool, termId)).toBe(1);

      const updated = await updateSectionStatuses(pool, termId, [
        { classNbr: '10001', status: 'waitlist' },
        { classNbr: 'nosuch', status: 'open' },
      ]);
      expect(updated).toBe(1);
      const status = await pool.query('SELECT enrollment_status FROM sections WHERE id = $1', [keptId]);
      expect(status.rows[0].enrollment_status).toBe('waitlist');

      const coursesDeleted = await deleteCoursesNotIn(pool, termId, []);
      expect(coursesDeleted).toBe(1);
    } finally {
      await pool.query('DELETE FROM terms WHERE code = $1', ['2299']);
      await pool.query('DELETE FROM departments WHERE code = $1', ['ZTST']);
      await pool.end();
    }
  });

  it('rolls the whole swap back when one write fails', async () => {
    const pool = createPool(TEST_URL!);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const termId = await upsertTerm(client, { code: '2298', name: 'Rollback Term' });
      expect(termId).toBeGreaterThan(0);
      await client.query('ROLLBACK');
      const after = await pool.query('SELECT id FROM terms WHERE code = $1', ['2298']);
      expect(after.rowCount).toBe(0);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/db test`
Expected: FAIL, "deleteSectionsNotIn is not a function" (or an import error).
If no test database is available, the block skips — in that case verify the failure by
running `npx pnpm --filter @csufsched/db typecheck`, which must report the missing exports.

- [ ] **Step 3: Add `Queryable` and widen the signatures in `db/src/upserts.ts`**

Replace the `import type pg from 'pg';` line and add the interface below it:

```ts
import type pg from 'pg';
import type { Day } from '@csufsched/types';

// A Pool or a PoolClient. The transactional swap needs every write on one client.
export interface Queryable {
  // `any` mirrors pg's own default row type; each caller narrows what it reads.
  query(text: string, values?: unknown[]): Promise<pg.QueryResult<any>>;
}
```

Then change the first parameter of `upsertTerm`, `upsertDepartment`, `upsertCourse`,
`upsertSection`, `upsertProfessor`, and `replaceMeetings` from `pool: pg.Pool` to
`db: Queryable`, renaming the uses of `pool.query` to `db.query` in each body. Leave
`replaceProfTags` on `pg.Pool` — the RMP scraper owns it and does not need widening.

Rewrite `replaceMeetings` without its own transaction:

```ts
export async function replaceMeetings(
  db: Queryable,
  sectionId: number,
  meetings: MeetingRow[],
): Promise<void> {
  await db.query('DELETE FROM meetings WHERE section_id = $1', [sectionId]);
  for (const m of meetings) {
    await db.query(
      `INSERT INTO meetings (section_id, days, start_min, end_min, building, room)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sectionId, m.days.join(','), m.startMin, m.endMin, m.building, m.room],
    );
  }
}
```

- [ ] **Step 4: Add the prune, count, and status-update functions**

Append to `db/src/upserts.ts`:

```ts
export async function countSectionsForTerm(db: Queryable, termId: number): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM sections s
     JOIN courses c ON c.id = s.course_id
     WHERE c.term_id = $1`,
    [termId],
  );
  return (res.rows[0] as { n: number }).n;
}

export async function deleteSectionsNotIn(
  db: Queryable,
  termId: number,
  keptSectionIds: number[],
): Promise<number> {
  const res = await db.query(
    `DELETE FROM sections s
     USING courses c
     WHERE c.id = s.course_id AND c.term_id = $1 AND NOT (s.id = ANY($2::int[]))`,
    [termId, keptSectionIds],
  );
  return res.rowCount ?? 0;
}

export async function deleteCoursesNotIn(
  db: Queryable,
  termId: number,
  keptCourseIds: number[],
): Promise<number> {
  const res = await db.query(
    `DELETE FROM courses WHERE term_id = $1 AND NOT (id = ANY($2::int[]))`,
    [termId, keptCourseIds],
  );
  return res.rowCount ?? 0;
}

export async function updateSectionStatuses(
  db: Queryable,
  termId: number,
  updates: Array<{ classNbr: string; status: string }>,
): Promise<number> {
  if (updates.length === 0) return 0;
  const res = await db.query(
    `UPDATE sections s
     SET enrollment_status = v.status
     FROM unnest($2::text[], $3::text[]) AS v(class_nbr, status),
          courses c
     WHERE c.id = s.course_id
       AND c.term_id = $1
       AND s.class_nbr = v.class_nbr
       AND s.enrollment_status IS DISTINCT FROM v.status`,
    [termId, updates.map((u) => u.classNbr), updates.map((u) => u.status)],
  );
  return res.rowCount ?? 0;
}
```

Note: the `IS DISTINCT FROM` guard means the returned count is "sections whose status
actually changed". The test above expects `1` because the seeded section moves from `open`
to `waitlist`.

- [ ] **Step 5: Export the new API from `db/src/index.ts`**

```ts
export {
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  replaceMeetings,
  upsertProfessor,
  replaceProfTags,
  countSectionsForTerm,
  deleteSectionsNotIn,
  deleteCoursesNotIn,
  updateSectionStatuses,
} from './upserts.ts';
export type {
  TermRow,
  DepartmentRow,
  CourseRow,
  SectionRow,
  MeetingRow,
  ProfessorRow,
  Queryable,
} from './upserts.ts';
```

- [ ] **Step 6: Run the db tests and typecheck the whole workspace**

Run: `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/db test`
Expected: PASS, including the two new cases.

Run: `npx pnpm typecheck`
Expected: no errors anywhere — the widened signatures are source-compatible with the existing
`pg.Pool` call sites in `scrapers/csuf/src/run.ts`, `scrapers/rmp/src/run.ts`, and
`db/src/seed.ts`.

- [ ] **Step 7: Commit**

```bash
git add db/src/upserts.ts db/src/index.ts db/tests/upserts.test.ts
git commit -m "feat(db): accept Pool or PoolClient and add prune plus status update helpers"
```

---

### Task 11: Transactional persist and prune (`persist.ts`)

**Files:**
- Create: `scrapers/csuf/src/persist.ts`
- Modify: `scrapers/csuf/src/types.ts` (append `PersistInput`, `PersistResult`)
- Test: `scrapers/csuf/tests/persist.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scrapers/csuf/tests/persist.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createPool } from '@csufsched/db';
import { persistTerm } from '../src/persist';
import type { ScrapedCourse } from '../src/types';

const TEST_URL = process.env.TEST_DATABASE_URL;

function course(overrides: Partial<ScrapedCourse> = {}): ScrapedCourse {
  return {
    deptCode: 'ZTST',
    catalogNbr: '101',
    title: 'Intro',
    units: 3,
    sections: [
      {
        classNbr: '90001',
        sectionCode: '01',
        instructorName: 'Ada Lovelace',
        mode: 'in-person',
        enrollmentStatus: 'open',
        meetings: [{ days: ['M', 'W'], startMin: 600, endMin: 650, building: 'CS', room: '101' }],
      },
    ],
    ...overrides,
  };
}

describe.skipIf(!TEST_URL)('persistTerm (integration)', () => {
  it('keeps section ids stable across runs, replaces meetings, and prunes vanished rows', async () => {
    const pool = createPool(TEST_URL!);
    try {
      const first = await persistTerm(pool, {
        termCode: '2299',
        termName: 'Test Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [course(), course({ catalogNbr: '102', title: 'Second' })],
      });
      expect(first.coursesUpserted).toBe(2);
      expect(first.sectionsUpserted).toBe(2);

      const before = await pool.query(
        `SELECT s.id FROM sections s JOIN courses c ON c.id = s.course_id
         JOIN terms t ON t.id = c.term_id WHERE t.code = '2299' AND s.class_nbr = '90001'`,
      );

      const second = await persistTerm(pool, {
        termCode: '2299',
        termName: 'Test Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [
          course({
            sections: [
              {
                classNbr: '90001',
                sectionCode: '01',
                instructorName: 'Ada Lovelace',
                mode: 'online',
                enrollmentStatus: 'closed',
                meetings: [],
              },
            ],
          }),
        ],
      });

      const after = await pool.query(
        `SELECT s.id, s.enrollment_status, s.mode FROM sections s
         JOIN courses c ON c.id = s.course_id JOIN terms t ON t.id = c.term_id
         WHERE t.code = '2299' AND s.class_nbr = '90001'`,
      );
      expect(after.rows[0].id).toBe(before.rows[0].id);
      expect(after.rows[0].enrollment_status).toBe('closed');
      expect(second.coursesDeleted).toBe(1);

      const meetings = await pool.query('SELECT count(*)::int AS n FROM meetings WHERE section_id = $1', [
        after.rows[0].id,
      ]);
      expect(meetings.rows[0].n).toBe(0);
    } finally {
      await pool.query(`DELETE FROM courses WHERE term_id IN (SELECT id FROM terms WHERE code = '2299')`);
      await pool.query(`DELETE FROM terms WHERE code = '2299'`);
      await pool.query(`DELETE FROM departments WHERE code = 'ZTST'`);
      await pool.query(`DELETE FROM professors WHERE full_name = 'Ada Lovelace'`);
      await pool.end();
    }
  });

  it('leaves the previous catalog untouched when a write fails mid-run', async () => {
    const pool = createPool(TEST_URL!);
    try {
      await persistTerm(pool, {
        termCode: '2297',
        termName: 'Rollback Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [course()],
      });

      // title is NOT NULL, so this write fails inside the transaction
      const bad = course({ catalogNbr: '103', title: null as unknown as string });
      await expect(
        persistTerm(pool, {
          termCode: '2297',
          termName: 'Rollback Term',
          departmentNames: new Map([['ZTST', 'Test Dept']]),
          courses: [course(), bad],
        }),
      ).rejects.toThrow();

      const survived = await pool.query(
        `SELECT count(*)::int AS n FROM courses c JOIN terms t ON t.id = c.term_id WHERE t.code = '2297'`,
      );
      expect(survived.rows[0].n).toBe(1);
    } finally {
      await pool.query(`DELETE FROM courses WHERE term_id IN (SELECT id FROM terms WHERE code = '2297')`);
      await pool.query(`DELETE FROM terms WHERE code = '2297'`);
      await pool.query(`DELETE FROM departments WHERE code = 'ZTST'`);
      await pool.query(`DELETE FROM professors WHERE full_name = 'Ada Lovelace'`);
      await pool.end();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/scraper-csuf test -- persist`
Expected: FAIL, "Cannot find module '../src/persist'". Without a test database the block
skips; in that case rely on `npx pnpm --filter @csufsched/scraper-csuf typecheck` reporting
the missing module.

- [ ] **Step 3: Append the persist types to `types.ts`**

```ts
export interface PersistInput {
  termCode: string;
  termName: string;
  departmentNames: Map<string, string>;
  courses: ScrapedCourse[];
}

export interface PersistResult {
  termId: number;
  coursesUpserted: number;
  sectionsUpserted: number;
  coursesDeleted: number;
  sectionsDeleted: number;
}
```

- [ ] **Step 4: Write `persist.ts`**

```ts
import type pg from 'pg';
import {
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  upsertProfessor,
  replaceMeetings,
  deleteCoursesNotIn,
  deleteSectionsNotIn,
} from '@csufsched/db';
import type { PersistInput, PersistResult } from './types.ts';

// One transaction for the whole term: readers on other connections keep seeing
// yesterday's catalog until commit, and section ids survive so Plan 4's share
// links stay valid.
export async function persistTerm(pool: pg.Pool, input: PersistInput): Promise<PersistResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const termId = await upsertTerm(client, { code: input.termCode, name: input.termName });

    const deptIds = new Map<string, number>();
    const professorIds = new Map<string, number>();
    const keptCourseIds: number[] = [];
    const keptSectionIds: number[] = [];

    for (const course of input.courses) {
      let deptId = deptIds.get(course.deptCode);
      if (deptId === undefined) {
        deptId = await upsertDepartment(client, {
          code: course.deptCode,
          name: input.departmentNames.get(course.deptCode) ?? course.deptCode,
        });
        deptIds.set(course.deptCode, deptId);
      }

      const courseId = await upsertCourse(client, {
        termId,
        deptId,
        catalogNbr: course.catalogNbr,
        title: course.title,
        units: course.units,
        description: null,
      });
      keptCourseIds.push(courseId);

      for (const s of course.sections) {
        let instructorId: number | null = null;
        if (s.instructorName !== null) {
          const cached = professorIds.get(s.instructorName);
          instructorId = cached ?? (await upsertProfessor(client, { fullName: s.instructorName }));
          professorIds.set(s.instructorName, instructorId);
        }
        const sectionId = await upsertSection(client, {
          courseId,
          classNbr: s.classNbr,
          sectionCode: s.sectionCode,
          instructorId,
          mode: s.mode,
          enrollmentStatus: s.enrollmentStatus,
        });
        keptSectionIds.push(sectionId);
        await replaceMeetings(client, sectionId, s.meetings);
      }
    }

    const sectionsDeleted = await deleteSectionsNotIn(client, termId, keptSectionIds);
    const coursesDeleted = await deleteCoursesNotIn(client, termId, keptCourseIds);

    await client.query('COMMIT');
    return {
      termId,
      coursesUpserted: keptCourseIds.length,
      sectionsUpserted: keptSectionIds.length,
      coursesDeleted,
      sectionsDeleted,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Run the test**

Run: `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/scraper-csuf test -- persist`
Expected: PASS, 2 tests (or 2 skipped without a database).

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/persist.ts scrapers/csuf/src/types.ts scrapers/csuf/tests/persist.test.ts
git commit -m "feat(scraper): persist a scraped term in one transaction with prune"
```

---

### Task 12: Full-run orchestration with the sanity gate (`run.ts`)

**Files:**
- Modify: `scrapers/csuf/src/run.ts` (replace `scrapeTerm` and the CLI wholesale)
- Modify: `scrapers/csuf/tests/run.test.ts` (replace wholesale)
- Test: `scrapers/csuf/tests/run.test.ts`

`scrapeTerm` and its `ScrapeTermOptions` disappear — nothing outside this package uses them
(`grep -rn "scrapeTerm" --include=*.ts .` returns only this package). The CLI moves to
Task 14.

- [ ] **Step 1: Replace `scrapers/csuf/tests/run.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { runFullScrape } from '../src/run';
import type { RawClassRow, ResultRow } from '../src/types';

function row(overrides: Partial<RawClassRow> = {}): RawClassRow {
  return {
    subject: 'CPSC',
    catalog_nbr: '121',
    descr: 'OOP',
    units: '',
    class_nbr: '12345',
    class_section: '01',
    instructor: 'Lee,J',
    meeting_days: 'MoWe',
    start_time: '10:00AM',
    end_time: '10:50AM',
    building: 'CS',
    room: '101',
    instruction_mode: 'P',
    enrollment_status: 'O',
    ...overrides,
  };
}

function resultRow(rowIndex: number, overrides: Partial<RawClassRow> = {}): ResultRow {
  return { rowIndex, row: row(overrides) };
}

function deps(over: Partial<Parameters<typeof runFullScrape>[0]> = {}) {
  return {
    catalog: {
      terms: [{ code: '2267', name: 'Fall 2026' }],
      subjects: [{ code: 'CPSC', name: 'Computer Science' }],
      careers: [{ code: 'UGRD', name: 'Undergraduate' }],
    },
    search: vi.fn(async () => [resultRow(0), resultRow(1, { class_nbr: '12346', class_section: '02' })]),
    fetchUnits: vi.fn(async () => '3'),
    countExistingSections: vi.fn(async () => 0),
    persist: vi.fn(async () => ({
      termId: 1, coursesUpserted: 1, sectionsUpserted: 2, coursesDeleted: 0, sectionsDeleted: 0,
    })),
    sanityMinRatio: 0.9,
    ...over,
  };
}

describe('runFullScrape', () => {
  it('searches every term x subject x career and persists the parsed courses', async () => {
    const d = deps();
    const summary = await runFullScrape(d);

    expect(d.search).toHaveBeenCalledWith({ termCode: '2267', subject: 'CPSC', career: 'UGRD' });
    expect(d.persist).toHaveBeenCalledTimes(1);
    expect(summary.searchesRun).toBe(1);
    expect(summary.sectionsParsed).toBe(2);
    expect(summary.terms[0].persisted?.sectionsUpserted).toBe(2);
  });

  it('fetches one detail page per course, not per section', async () => {
    const d = deps();
    await runFullScrape(d);
    expect(d.fetchUnits).toHaveBeenCalledTimes(1);
    expect(d.fetchUnits).toHaveBeenCalledWith(0);
  });

  it('reuses the cached units when the same course appears under another career', async () => {
    const d = deps({
      catalog: {
        terms: [{ code: '2267', name: 'Fall 2026' }],
        subjects: [{ code: 'CPSC', name: 'Computer Science' }],
        careers: [
          { code: 'UGRD', name: 'Undergraduate' },
          { code: 'PBAC', name: 'Postbaccalaureate' },
        ],
      },
    });
    await runFullScrape(d);
    expect(d.search).toHaveBeenCalledTimes(2);
    expect(d.fetchUnits).toHaveBeenCalledTimes(1);
  });

  it('passes real department names through to persist', async () => {
    const d = deps();
    await runFullScrape(d);
    expect(d.persist.mock.calls[0][0].departmentNames.get('CPSC')).toBe('Computer Science');
  });

  it('records a failed search and keeps going', async () => {
    const d = deps({
      catalog: {
        terms: [{ code: '2267', name: 'Fall 2026' }],
        subjects: [
          { code: 'CPSC', name: 'Computer Science' },
          { code: 'MATH', name: 'Mathematics' },
        ],
        careers: [{ code: 'UGRD', name: 'Undergraduate' }],
      },
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([resultRow(0, { subject: 'MATH', catalog_nbr: '150B' })]),
    });
    const summary = await runFullScrape(d);

    expect(summary.searchErrors).toEqual([{ term: '2267', subject: 'CPSC', career: 'UGRD', error: 'boom' }]);
    expect(d.persist).toHaveBeenCalledTimes(1);
  });

  it('records a failed detail fetch and skips that course', async () => {
    const d = deps({ fetchUnits: vi.fn(async () => { throw new Error('detail down'); }) });
    const summary = await runFullScrape(d);

    expect(summary.detailErrors).toHaveLength(1);
    expect(summary.detailErrors[0].course).toBe('CPSC 121');
    expect(d.persist.mock.calls[0][0].courses).toHaveLength(0);
  });

  it('aborts the term without writing when the sanity ratio is not met', async () => {
    const d = deps({ countExistingSections: vi.fn(async () => 100) });
    const summary = await runFullScrape(d);

    expect(d.persist).not.toHaveBeenCalled();
    expect(summary.terms[0].abortedBySanityGate).toBe(true);
    expect(summary.ok).toBe(false);
  });

  it('passes the gate on a first run against an empty database', async () => {
    const d = deps({ countExistingSections: vi.fn(async () => 0) });
    const summary = await runFullScrape(d);

    expect(d.persist).toHaveBeenCalledTimes(1);
    expect(summary.ok).toBe(true);
  });

  it('honours a term filter', async () => {
    const d = deps({
      catalog: {
        terms: [
          { code: '2267', name: 'Fall 2026' },
          { code: '2265', name: 'Summer 2026' },
        ],
        subjects: [{ code: 'CPSC', name: 'Computer Science' }],
        careers: [{ code: 'UGRD', name: 'Undergraduate' }],
      },
      termCodes: ['2265'],
    });
    await runFullScrape(d);
    expect(d.search).toHaveBeenCalledTimes(1);
    expect(d.search.mock.calls[0][0].termCode).toBe('2265');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- run`
Expected: FAIL, "runFullScrape is not exported".

- [ ] **Step 3: Replace the body of `scrapers/csuf/src/run.ts`**

Delete everything currently in the file (both `scrapeTerm` and the CLI block) and write:

```ts
import { parseClassRows } from './parse.ts';
import type {
  Catalog,
  PersistInput,
  PersistResult,
  ResultRow,
  SearchCriteria,
} from './types.ts';

export interface FullScrapeDeps {
  catalog: Catalog;
  search: (criteria: SearchCriteria) => Promise<ResultRow[]>;
  fetchUnits: (rowIndex: number) => Promise<string>;
  countExistingSections: (termCode: string) => Promise<number>;
  persist: (input: PersistInput) => Promise<PersistResult>;
  sanityMinRatio: number;
  termCodes?: string[];
}

export interface TermSummary {
  termCode: string;
  sectionsParsed: number;
  sectionsBefore: number;
  abortedBySanityGate: boolean;
  persisted: PersistResult | null;
}

export interface ScrapeSummary {
  ok: boolean;
  searchesRun: number;
  sectionsParsed: number;
  terms: TermSummary[];
  searchErrors: Array<{ term: string; subject: string; career: string; error: string }>;
  detailErrors: Array<{ course: string; error: string }>;
  rowsSkipped: Array<{ row: unknown; error: string }>;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runFullScrape(deps: FullScrapeDeps): Promise<ScrapeSummary> {
  const summary: ScrapeSummary = {
    ok: true,
    searchesRun: 0,
    sectionsParsed: 0,
    terms: [],
    searchErrors: [],
    detailErrors: [],
    rowsSkipped: [],
  };

  const terms = deps.termCodes
    ? deps.catalog.terms.filter((t) => deps.termCodes?.includes(t.code))
    : deps.catalog.terms;
  const departmentNames = new Map(deps.catalog.subjects.map((s) => [s.code, s.name]));

  for (const term of terms) {
    // Units are a course attribute, so one detail fetch serves every section and
    // every career that offers the course.
    const unitsByCourse = new Map<string, string>();
    const rows: ResultRow[] = [];

    for (const subject of deps.catalog.subjects) {
      for (const career of deps.catalog.careers) {
        const criteria = { termCode: term.code, subject: subject.code, career: career.code };
        let found: ResultRow[];
        try {
          found = await deps.search(criteria);
        } catch (err) {
          summary.searchErrors.push({
            term: term.code,
            subject: subject.code,
            career: career.code,
            error: message(err),
          });
          continue;
        }
        summary.searchesRun += 1;

        for (const result of found) {
          const key = `${result.row.subject} ${result.row.catalog_nbr}`;
          if (!unitsByCourse.has(key)) {
            try {
              unitsByCourse.set(key, await deps.fetchUnits(result.rowIndex));
            } catch (err) {
              summary.detailErrors.push({ course: key, error: message(err) });
              unitsByCourse.set(key, '');
            }
          }
          rows.push(result);
        }
      }
    }

    const withUnits = rows
      .map((r) => ({ ...r.row, units: unitsByCourse.get(`${r.row.subject} ${r.row.catalog_nbr}`) ?? '' }))
      .filter((r) => r.units !== '');
    const { courses, skipped } = parseClassRows(withUnits);
    summary.rowsSkipped.push(...skipped);

    const sectionsParsed = courses.reduce((n, c) => n + c.sections.length, 0);
    summary.sectionsParsed += sectionsParsed;
    const sectionsBefore = await deps.countExistingSections(term.code);
    const gatePassed = sectionsBefore === 0 || sectionsParsed / sectionsBefore >= deps.sanityMinRatio;

    if (!gatePassed) {
      summary.ok = false;
      summary.terms.push({
        termCode: term.code,
        sectionsParsed,
        sectionsBefore,
        abortedBySanityGate: true,
        persisted: null,
      });
      continue;
    }

    const persisted = await deps.persist({
      termCode: term.code,
      termName: term.name,
      departmentNames,
      courses,
    });
    summary.terms.push({
      termCode: term.code,
      sectionsParsed,
      sectionsBefore,
      abortedBySanityGate: false,
      persisted,
    });
  }

  return summary;
}
```

- [ ] **Step 4: Run the test**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- run`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add scrapers/csuf/src/run.ts scrapers/csuf/tests/run.test.ts
git commit -m "feat(scraper): orchestrate the full scrape behind a sanity gate"
```

---

### Task 13: Hourly status refresh (`statusRefresh.ts`)

**Files:**
- Create: `scrapers/csuf/src/statusRefresh.ts`
- Test: `scrapers/csuf/tests/statusRefresh.test.ts`

List-only pass over the current term: no detail fetches, one batched update, its own gate.

- [ ] **Step 1: Write the failing test**

Create `scrapers/csuf/tests/statusRefresh.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { refreshStatuses } from '../src/statusRefresh';
import type { RawClassRow, ResultRow } from '../src/types';

function resultRow(rowIndex: number, classNbr: string, status: string): ResultRow {
  const row: RawClassRow = {
    subject: 'CPSC', catalog_nbr: '121', descr: 'OOP', units: '',
    class_nbr: classNbr, class_section: '01', instructor: 'Lee,J',
    meeting_days: 'MoWe', start_time: '10:00AM', end_time: '10:50AM',
    building: 'CS', room: '101', instruction_mode: 'P', enrollment_status: status,
  };
  return { rowIndex, row };
}

function deps(over = {}) {
  return {
    termCode: '2267',
    subjects: ['CPSC', 'MATH'],
    careers: ['UGRD'],
    search: vi.fn(async () => [resultRow(0, '12345', 'O'), resultRow(1, '12346', 'W')]),
    countExistingSections: vi.fn(async () => 4),
    applyUpdates: vi.fn(async () => 2),
    sanityMinRatio: 0.9,
    ...over,
  };
}

describe('refreshStatuses', () => {
  it('searches every subject x career for the one term and applies mapped statuses', async () => {
    const d = deps();
    const summary = await refreshStatuses(d);

    expect(d.search).toHaveBeenCalledTimes(2);
    expect(d.search.mock.calls[0][0]).toEqual({ termCode: '2267', subject: 'CPSC', career: 'UGRD' });
    expect(d.applyUpdates).toHaveBeenCalledWith([
      { classNbr: '12345', status: 'open' },
      { classNbr: '12346', status: 'waitlist' },
      { classNbr: '12345', status: 'open' },
      { classNbr: '12346', status: 'waitlist' },
    ]);
    expect(summary.sectionsObserved).toBe(4);
    expect(summary.sectionsUpdated).toBe(2);
    expect(summary.ok).toBe(true);
  });

  it('skips a row whose status icon is unknown and reports it', async () => {
    const d = deps({
      search: vi.fn(async () => [resultRow(0, '12345', 'X')]),
      subjects: ['CPSC'],
      countExistingSections: vi.fn(async () => 1),
    });
    const summary = await refreshStatuses(d);

    expect(summary.rowsSkipped).toHaveLength(1);
    expect(d.applyUpdates).toHaveBeenCalledWith([]);
  });

  it('aborts without writing when it observes too few sections', async () => {
    const d = deps({ countExistingSections: vi.fn(async () => 1000) });
    const summary = await refreshStatuses(d);

    expect(d.applyUpdates).not.toHaveBeenCalled();
    expect(summary.abortedBySanityGate).toBe(true);
    expect(summary.ok).toBe(false);
  });

  it('records a failed search and keeps going', async () => {
    const d = deps({
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([resultRow(0, '12345', 'C')]),
      countExistingSections: vi.fn(async () => 1),
    });
    const summary = await refreshStatuses(d);

    expect(summary.searchErrors).toEqual([{ subject: 'CPSC', career: 'UGRD', error: 'boom' }]);
    expect(d.applyUpdates).toHaveBeenCalledWith([{ classNbr: '12345', status: 'closed' }]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- statusRefresh`
Expected: FAIL, "Cannot find module '../src/statusRefresh'".

- [ ] **Step 3: Write `statusRefresh.ts`**

```ts
import type { ResultRow, SearchCriteria } from './types.ts';

const STATUS_MAP: Record<string, string> = { O: 'open', C: 'closed', W: 'waitlist' };

export interface StatusRefreshDeps {
  termCode: string;
  subjects: string[];
  careers: string[];
  search: (criteria: SearchCriteria) => Promise<ResultRow[]>;
  countExistingSections: () => Promise<number>;
  applyUpdates: (updates: Array<{ classNbr: string; status: string }>) => Promise<number>;
  sanityMinRatio: number;
}

export interface StatusRefreshSummary {
  ok: boolean;
  sectionsObserved: number;
  sectionsUpdated: number;
  abortedBySanityGate: boolean;
  searchErrors: Array<{ subject: string; career: string; error: string }>;
  rowsSkipped: Array<{ classNbr: string; error: string }>;
}

export async function refreshStatuses(deps: StatusRefreshDeps): Promise<StatusRefreshSummary> {
  const summary: StatusRefreshSummary = {
    ok: true,
    sectionsObserved: 0,
    sectionsUpdated: 0,
    abortedBySanityGate: false,
    searchErrors: [],
    rowsSkipped: [],
  };

  const updates: Array<{ classNbr: string; status: string }> = [];

  for (const subject of deps.subjects) {
    for (const career of deps.careers) {
      let found: ResultRow[];
      try {
        found = await deps.search({ termCode: deps.termCode, subject, career });
      } catch (err) {
        summary.searchErrors.push({
          subject,
          career,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const { row } of found) {
        summary.sectionsObserved += 1;
        const status = STATUS_MAP[row.enrollment_status];
        if (status === undefined) {
          summary.rowsSkipped.push({
            classNbr: row.class_nbr,
            error: `unknown enrollment_status "${row.enrollment_status}"`,
          });
          continue;
        }
        updates.push({ classNbr: row.class_nbr, status });
      }
    }
  }

  const known = await deps.countExistingSections();
  if (known > 0 && summary.sectionsObserved / known < deps.sanityMinRatio) {
    summary.ok = false;
    summary.abortedBySanityGate = true;
    return summary;
  }

  summary.sectionsUpdated = await deps.applyUpdates(updates);
  return summary;
}
```

- [ ] **Step 4: Run the test**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- statusRefresh`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scrapers/csuf/src/statusRefresh.ts scrapers/csuf/tests/statusRefresh.test.ts
git commit -m "feat(scraper): add hourly enrollment status refresh pass"
```

---

### Task 14: CLI entrypoints and package exports

**Files:**
- Create: `scrapers/csuf/src/cli.ts`
- Modify: `scrapers/csuf/src/index.ts`
- Modify: `scrapers/csuf/package.json`

Both cron jobs enter here. Wiring is untested by design — every decision it makes lives in a
tested module — so keep it thin.

- [ ] **Step 1: Write `scrapers/csuf/src/cli.ts`**

```ts
import { createPool, countSectionsForTerm, updateSectionStatuses, upsertTerm } from '@csufsched/db';
import { openSession, DEFAULT_BASE_URL } from './session.ts';
import { parseCatalog } from './catalog.ts';
import { runSearch, resetSearch } from './searchPage.ts';
import { parseResultRows } from './parseResults.ts';
import { fetchUnits } from './detail.ts';
import { persistTerm } from './persist.ts';
import { runFullScrape } from './run.ts';
import { refreshStatuses } from './statusRefresh.ts';
import { rateLimited, fetchWithBackoff } from './rateLimit.ts';
import type { ResultRow, SearchCriteria } from './types.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Required env: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== 'full' && mode !== 'status') {
    console.error('Usage: cli.ts <full|status>');
    process.exit(1);
  }

  const databaseUrl = required('DATABASE_URL');
  const baseUrl = process.env.CSUF_BASE_URL ?? DEFAULT_BASE_URL;
  const rateLimitMs = Number(process.env.RATE_LIMIT_MS ?? '1000');
  const sanityMinRatio = Number(process.env.SANITY_MIN_RATIO ?? '0.9');

  const pool = createPool(databaseUrl);
  const limited = rateLimited(
    (url: string, init?: RequestInit) =>
      fetchWithBackoff(url, fetch, { retries: 3, baseDelayMs: rateLimitMs }, init),
    rateLimitMs,
  );
  const session = await openSession({ baseUrl, fetchFn: limited });
  const catalog = parseCatalog(session.entryHtml);

  // Detail fetches return to the results page themselves, so the only extra
  // navigation is resetting the previous search before opening the next one.
  let searchOpen = false;
  const search = async (criteria: SearchCriteria): Promise<ResultRow[]> => {
    if (searchOpen) {
      await resetSearch(session);
      searchOpen = false;
    }
    const html = await runSearch(session, criteria);
    searchOpen = html !== null;
    return html === null ? [] : parseResultRows(html).rows;
  };

  const sectionsForTerm = async (termCode: string): Promise<number> => {
    const res = await pool.query('SELECT id FROM terms WHERE code = $1', [termCode]);
    if (res.rowCount === 0) return 0;
    return countSectionsForTerm(pool, res.rows[0].id as number);
  };

  if (mode === 'full') {
    const summary = await runFullScrape({
      catalog,
      search,
      fetchUnits: (rowIndex) => fetchUnits(session, rowIndex),
      countExistingSections: sectionsForTerm,
      persist: (input) => persistTerm(pool, input),
      sanityMinRatio,
      termCodes: process.env.TERM_CODES?.split(',').filter(Boolean),
    });
    console.log(JSON.stringify(summary, null, 2));
    await pool.end();
    process.exit(summary.ok ? 0 : 1);
  }

  const termCode = required('TERM_CODE');
  const termId = await upsertTerm(pool, { code: termCode, name: process.env.TERM_NAME ?? termCode });
  const summary = await refreshStatuses({
    termCode,
    subjects: catalog.subjects.map((s) => s.code),
    careers: catalog.careers.map((c) => c.code),
    search,
    countExistingSections: () => countSectionsForTerm(pool, termId),
    applyUpdates: (updates) => updateSectionStatuses(pool, termId, updates),
    sanityMinRatio,
  });
  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
  process.exit(summary.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Sanity-check the navigation order by hand**

Read the `search` closure once more against the action table at the top of this plan. The
required order per subject is: `NEW_SEARCH` (only if a previous search is still open) →
`CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH` → optional `#ICSave` → N × (`MTG_CLASS_NBR$i` → `BACK`).
Resetting before the search rather than after it is deliberate: the detail fetches for the
current search happen after `search` returns, so an eager reset would discard the results page
they need.

- [ ] **Step 3: Update `scrapers/csuf/src/index.ts`**

```ts
export { parseDays, parseTime, parseClassRows } from './parse.ts';
export type { ParseResult } from './parse.ts';
export type {
  RawClassRow,
  ScrapedMeeting,
  ScrapedSection,
  ScrapedCourse,
  SearchCriteria,
  CatalogOption,
  Catalog,
  ResultRow,
  PersistInput,
  PersistResult,
} from './types.ts';
export { rateLimited, fetchWithBackoff } from './rateLimit.ts';
export type { FetchLike, BackoffOptions } from './rateLimit.ts';
export { openSession, isSessionExpired, DEFAULT_BASE_URL } from './session.ts';
export type { PeopleSoftSession, SessionOptions } from './session.ts';
export { ENVELOPE_FIELDS, buildSearchFields } from './forms.ts';
export { parseCatalog } from './catalog.ts';
export { parseResultRows } from './parseResults.ts';
export { fetchUnits, parseUnitsRange } from './detail.ts';
export { runSearch, resetSearch } from './searchPage.ts';
export { persistTerm } from './persist.ts';
export { runFullScrape } from './run.ts';
export type { FullScrapeDeps, ScrapeSummary, TermSummary } from './run.ts';
export { refreshStatuses } from './statusRefresh.ts';
export type { StatusRefreshDeps, StatusRefreshSummary } from './statusRefresh.ts';
```

- [ ] **Step 4: Replace the `scrape` script in `scrapers/csuf/package.json`**

```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "scrape:full": "node --experimental-strip-types src/cli.ts full",
    "scrape:status": "node --experimental-strip-types src/cli.ts status",
    "record-fixtures": "node --experimental-strip-types scripts/record-fixtures.ts"
  },
```

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `npx pnpm typecheck && npx pnpm test`
Expected: all packages green. If `apps/api` fails to resolve a removed export, it means
something outside the scraper depended on `scrapeTerm` — re-check with
`grep -rn "scrapeTerm\|ScrapeTermOptions" --include=*.ts . | grep -v node_modules` and remove
the stale reference.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/cli.ts scrapers/csuf/src/index.ts scrapers/csuf/package.json
git commit -m "feat(scraper): add full-run and status-refresh CLI entrypoints"
```

---

### Task 15: Live smoke test and operations notes

**Files:**
- Create: `scrapers/csuf/tests/live.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the opt-in live test**

Create `scrapers/csuf/tests/live.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openSession, DEFAULT_BASE_URL } from '../src/session';
import { parseCatalog } from '../src/catalog';
import { runSearch } from '../src/searchPage';
import { parseResultRows } from '../src/parseResults';
import { fetchUnits } from '../src/detail';
import { rateLimited, fetchWithBackoff } from '../src/rateLimit';

const LIVE = process.env.LIVE_SCRAPE === '1';

describe.skipIf(!LIVE)('live CSUF class search', () => {
  it('opens a session, searches CPSC, and reads units from a detail page', async () => {
    const limited = rateLimited(
      (url: string, init?: RequestInit) => fetchWithBackoff(url, fetch, { retries: 2, baseDelayMs: 1000 }, init),
      1000,
    );
    const session = await openSession({ baseUrl: DEFAULT_BASE_URL, fetchFn: limited });
    const catalog = parseCatalog(session.entryHtml);
    expect(catalog.subjects.length).toBeGreaterThan(80);

    const termCode = catalog.terms[0].code;
    const html = await runSearch(session, { termCode, subject: 'CPSC', career: 'UGRD' });
    expect(html).not.toBeNull();

    const { rows, skipped } = parseResultRows(html!);
    expect(rows.length).toBeGreaterThan(20);
    expect(skipped).toHaveLength(0);

    const units = await fetchUnits(session, rows[0].rowIndex);
    expect(units).toMatch(/^\d+(\s*-\s*\d+)?$/);
  }, 180_000);
});
```

- [ ] **Step 2: Run it against the live site once**

Run: `LIVE_SCRAPE=1 npx pnpm --filter @csufsched/scraper-csuf test -- live`
Expected: PASS. A failure here means CSUF changed markup — re-record fixtures with
`npx pnpm --filter @csufsched/scraper-csuf record-fixtures` and fix the parser the fixture
tests now flag.

- [ ] **Step 3: Confirm it stays out of the default run**

Run: `npx pnpm --filter @csufsched/scraper-csuf test`
Expected: the live block reports as skipped; the rest pass.

- [ ] **Step 4: Document operations in `README.md`**

Append:

```markdown
## Scraper operations

Environment: `DATABASE_URL` (required), `CSUF_BASE_URL` (defaults to the public Class Search
URL), `RATE_LIMIT_MS` (default 1000), `SANITY_MIN_RATIO` (default 0.9), `TERM_CODES`
(optional comma-separated filter for the full run), `TERM_CODE` (required for the status
refresh).

Both jobs exit nonzero when their sanity gate trips, so cron mails the operator.

```cron
# nightly full catalog scrape (~1.5h at 1 req/s)
15 3 * * * cd /srv/csufsched && DATABASE_URL=... npx pnpm --filter @csufsched/scraper-csuf scrape:full

# hourly open/closed refresh for the current term (~9 min)
20 * * * * cd /srv/csufsched && DATABASE_URL=... TERM_CODE=2267 npx pnpm --filter @csufsched/scraper-csuf scrape:status
```

Re-record test fixtures after a CSUF markup change:
`npx pnpm --filter @csufsched/scraper-csuf record-fixtures`
```

- [ ] **Step 5: Commit**

```bash
git add scrapers/csuf/tests/live.test.ts README.md
git commit -m "test(scraper): add opt-in live smoke test and document cron operations"
```

---

## Final verification

- [ ] `npx pnpm typecheck` — clean across all packages.
- [ ] `npx pnpm test` — green, with db and persist integration blocks skipped or passing.
- [ ] `TEST_DATABASE_URL=... npx pnpm test` — green with the integration blocks running.
- [ ] `LIVE_SCRAPE=1 npx pnpm --filter @csufsched/scraper-csuf test -- live` — green.
- [ ] A full run against a scratch database: `DATABASE_URL=... TERM_CODES=2267 npx pnpm --filter @csufsched/scraper-csuf scrape:full`, then re-run it and confirm `SELECT count(*) FROM sections` is stable and section ids did not change (`SELECT id, class_nbr FROM sections ORDER BY class_nbr LIMIT 5` before and after).
- [ ] Load the web app against that database and confirm a share link built before the second run still resolves.
