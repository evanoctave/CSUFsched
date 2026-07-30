# Plan 5 Scraper Safety Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plan 5 scraper fail closed so partial PeopleSoft data, expired sessions, and invalid operator input cannot prune valid catalog rows or report success.

**Architecture:** Pure validation functions reject bad configuration and catalog selection before work begins. Full and status orchestration accumulate diagnostics but perform no writes after any incomplete input. Session generations let search orchestration restart complete search flows without replaying page-dependent actions, while result parsing expands multi-pattern HTML rows into existing flat `RawClassRow` inputs.

**Tech Stack:** TypeScript strict, Node 22.6+ global `fetch`, Vitest, PostgreSQL 17 via `pg`, pnpm workspace.

## Global Constraints

- Preserve existing database schema and stable section ids.
- Never call `persistTerm` for an incomplete term.
- Never call `applyUpdates` for an incomplete status pass.
- Keep PeopleSoft request rate default at 1000 ms.
- Run pnpm through `npx pnpm` from repository root.
- Write every behavior change test first and observe expected failure before production edits.
- Do not change recorded fixture markup except through targeted recording or a verbatim extracted live group.
- Keep live network tests opt-in behind `LIVE_SCRAPE=1`.

## File Structure

```
scrapers/csuf/
  src/
    validation.ts             NEW: pure config, catalog, and term-selection validation
    statusTerm.ts             NEW: require live-catalog and database term for status mode
    run.ts                    fail-closed term persistence
    statusRefresh.ts          unique status gate and fail-closed updates
    session.ts                generation plus typed session-reset error
    searchPage.ts             whole-search retry and generation-aware reset
    parseResults.ts           expand multi-pattern HTML result rows
    cli.ts                    validated config and existing status term wiring
    index.ts                  export new public interfaces
  tests/
    validation.test.ts        NEW
    statusTerm.test.ts        NEW
    run.test.ts               fail-closed regressions
    statusRefresh.test.ts     unique-count and fail-closed regressions
    session.test.ts           no stateful action replay
    searchPage.test.ts        whole-search recovery
    parseResults.test.ts      multi-pattern expansion
    parse.test.ts             expanded rows merge into one section
    fixtures/
      results-multi.html      NEW: verbatim live group with multiple meeting patterns
  scripts/
    record-fixtures.ts        extract representative multi-pattern group
docs/superpowers/specs/
  2026-07-30-plan-5-safety-hardening-design.md
```

---

### Task 1: Runtime and Catalog Validation

**Files:**
- Create: `scrapers/csuf/src/validation.ts`
- Create: `scrapers/csuf/tests/validation.test.ts`
- Modify: `scrapers/csuf/src/index.ts`

**Interfaces:**
- Consumes: `Catalog`, `CatalogOption` from `src/types.ts`.
- Produces:
  - `parseNonNegativeNumber(name: string, raw: string | undefined, fallback: number): number`
  - `parseRatio(name: string, raw: string | undefined, fallback: number): number`
  - `parseTermCodes(raw: string | undefined): string[] | undefined`
  - `validateCatalog(catalog: Catalog): void`
  - `selectTerms(catalog: Catalog, requested?: string[]): CatalogOption[]`
  - `requireCatalogTerm(catalog: Catalog, code: string): CatalogOption`

- [ ] **Step 1: Write failing validation tests**

Create `scrapers/csuf/tests/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  parseNonNegativeNumber,
  parseRatio,
  parseTermCodes,
  requireCatalogTerm,
  selectTerms,
  validateCatalog,
} from '../src/validation';
import type { Catalog } from '../src/types';

const catalog: Catalog = {
  terms: [
    { code: '2267', name: 'Fall 2026' },
    { code: '2265', name: 'Summer 2026' },
  ],
  subjects: [{ code: 'CPSC', name: 'Computer Science' }],
  careers: [{ code: 'UGRD', name: 'Undergraduate' }],
};

describe('numeric runtime validation', () => {
  it('uses defaults and accepts boundary values', () => {
    expect(parseNonNegativeNumber('RATE_LIMIT_MS', undefined, 1000)).toBe(1000);
    expect(parseNonNegativeNumber('RATE_LIMIT_MS', '0', 1000)).toBe(0);
    expect(parseRatio('SANITY_MIN_RATIO', '1', 0.9)).toBe(1);
  });

  it.each(['NaN', 'Infinity', '-1'])('rejects invalid nonnegative number %s', (raw) => {
    expect(() => parseNonNegativeNumber('RATE_LIMIT_MS', raw, 1000)).toThrow(
      /RATE_LIMIT_MS/,
    );
  });

  it.each(['NaN', 'Infinity', '0', '-0.1', '1.01'])('rejects invalid ratio %s', (raw) => {
    expect(() => parseRatio('SANITY_MIN_RATIO', raw, 0.9)).toThrow(
      /SANITY_MIN_RATIO/,
    );
  });
});

describe('term-list parsing', () => {
  it('trims, removes blanks, and deduplicates while preserving order', () => {
    expect(parseTermCodes(' 2267,2265,2267, ,')).toEqual(['2267', '2265']);
    expect(parseTermCodes(undefined)).toBeUndefined();
  });

  it('rejects a supplied list containing no term codes', () => {
    expect(() => parseTermCodes(' , ')).toThrow(/TERM_CODES/);
  });
});

describe('catalog validation and selection', () => {
  it.each(['terms', 'subjects', 'careers'] as const)('rejects empty %s', (key) => {
    expect(() => validateCatalog({ ...catalog, [key]: [] })).toThrow(
      new RegExp(key, 'i'),
    );
  });

  it('selects requested terms in catalog order', () => {
    expect(selectTerms(catalog, ['2265'])).toEqual([
      { code: '2265', name: 'Summer 2026' },
    ]);
  });

  it('rejects every requested term missing from live catalog', () => {
    expect(() => selectTerms(catalog, ['9999', '2267'])).toThrow(/9999/);
  });

  it('requires one exact catalog term for status mode', () => {
    expect(requireCatalogTerm(catalog, '2267').name).toBe('Fall 2026');
    expect(() => requireCatalogTerm(catalog, '9999')).toThrow(/9999/);
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- validation
```

Expected: FAIL with `Cannot find module '../src/validation'`.

- [ ] **Step 3: Implement pure validation**

Create `scrapers/csuf/src/validation.ts`:

```ts
import type { Catalog, CatalogOption } from './types.ts';

export function parseNonNegativeNumber(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number greater than or equal to 0`);
  }
  return value;
}

export function parseRatio(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be a finite number greater than 0 and at most 1`);
  }
  return value;
}

export function parseTermCodes(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const codes = [...new Set(raw.split(',').map((code) => code.trim()).filter(Boolean))];
  if (codes.length === 0) throw new Error('TERM_CODES must contain at least one term code');
  return codes;
}

export function validateCatalog(catalog: Catalog): void {
  for (const key of ['terms', 'subjects', 'careers'] as const) {
    if (catalog[key].length === 0) {
      throw new Error(`live catalog contains no ${key}`);
    }
  }
}

export function selectTerms(catalog: Catalog, requested?: string[]): CatalogOption[] {
  validateCatalog(catalog);
  if (requested === undefined) return catalog.terms;
  const known = new Set(catalog.terms.map((term) => term.code));
  const missing = requested.filter((code) => !known.has(code));
  if (missing.length > 0) {
    throw new Error(`requested term codes absent from live catalog: ${missing.join(', ')}`);
  }
  const wanted = new Set(requested);
  return catalog.terms.filter((term) => wanted.has(term.code));
}

export function requireCatalogTerm(catalog: Catalog, code: string): CatalogOption {
  validateCatalog(catalog);
  const term = catalog.terms.find((candidate) => candidate.code === code);
  if (term === undefined) throw new Error(`term ${code} absent from live catalog`);
  return term;
}
```

Add exports to `scrapers/csuf/src/index.ts`:

```ts
export {
  parseNonNegativeNumber,
  parseRatio,
  parseTermCodes,
  validateCatalog,
  selectTerms,
  requireCatalogTerm,
} from './validation.ts';
```

- [ ] **Step 4: Run validation tests and typecheck**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- validation
npx pnpm --filter @csufsched/scraper-csuf typecheck
```

Expected: validation tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add scrapers/csuf/src/validation.ts scrapers/csuf/src/index.ts \
  scrapers/csuf/tests/validation.test.ts
git commit -m "feat(scraper): validate runtime config and catalog terms"
```

---

### Task 2: Fail-Closed Full-Term Persistence

**Files:**
- Modify: `scrapers/csuf/src/run.ts`
- Modify: `scrapers/csuf/tests/run.test.ts`

**Interfaces:**
- Consumes: `selectTerms(catalog, requested?)` from Task 1.
- Produces: `TermSummary.abortedByErrors: boolean`.
- Preserves: `runFullScrape(deps: FullScrapeDeps): Promise<ScrapeSummary>`.

- [ ] **Step 1: Change failed-search regression to require zero writes**

In `scrapers/csuf/tests/run.test.ts`, replace the existing
`records a failed search and keeps going` expectations with:

```ts
  it('runs remaining searches but persists nothing after one search fails', async () => {
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
        .mockResolvedValueOnce(outcome([resultRow(0, {
          subject: 'MATH',
          catalog_nbr: '150B',
        })])),
    });

    const summary = await runFullScrape(d);

    expect(d.search).toHaveBeenCalledTimes(2);
    expect(d.persist).not.toHaveBeenCalled();
    expect(summary.ok).toBe(false);
    expect(summary.searchErrors).toEqual([
      { term: '2267', subject: 'CPSC', career: 'UGRD', error: 'boom' },
    ]);
    expect(summary.terms[0]).toMatchObject({
      abortedByErrors: true,
      abortedBySanityGate: false,
      persisted: null,
    });
  });
```

- [ ] **Step 2: Add regressions for every remaining incomplete-input source**

Append the HTML-skip and malformed-row tests inside `describe('runFullScrape')`:

```ts
  it('persists nothing when the HTML parser skipped a result row', async () => {
    const d = deps({
      search: vi.fn(async () =>
        outcome([resultRow(0)], [{ rowIndex: 4, error: 'missing room' }])),
      countExistingSections: vi.fn(async () => 0),
    });

    const summary = await runFullScrape(d);

    expect(d.persist).not.toHaveBeenCalled();
    expect(summary.ok).toBe(false);
    expect(summary.terms[0].abortedByErrors).toBe(true);
  });

  it('persists nothing when parseClassRows skips a malformed row', async () => {
    const d = deps({
      search: vi.fn(async () =>
        outcome([resultRow(0, { meeting_days: 'Monday' })])),
      countExistingSections: vi.fn(async () => 0),
    });

    const summary = await runFullScrape(d);

    expect(d.persist).not.toHaveBeenCalled();
    expect(summary.rowsSkipped).toHaveLength(1);
    expect(summary.terms[0].abortedByErrors).toBe(true);
  });
```

Replace the existing `records a failed detail fetch and skips that course` test with:

```ts
  it('persists nothing when a detail fetch fails', async () => {
    const d = deps({
      fetchUnits: vi.fn(async () => {
        throw new Error('detail down');
      }),
      countExistingSections: vi.fn(async () => 0),
    });

    const summary = await runFullScrape(d);

    expect(d.persist).not.toHaveBeenCalled();
    expect(summary.detailErrors).toHaveLength(1);
    expect(summary.terms[0].abortedByErrors).toBe(true);
  });
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- run
```

Expected: new tests FAIL because `persist` is called and `abortedByErrors` is absent.

- [ ] **Step 4: Add abort flag and local completeness tracking**

In `scrapers/csuf/src/run.ts`, import `selectTerms`:

```ts
import { selectTerms } from './validation.ts';
```

Add field to `TermSummary`:

```ts
  abortedByErrors: boolean;
```

Replace term selection with:

```ts
  const terms = selectTerms(deps.catalog, deps.termCodes);
```

At start of each term loop, add:

```ts
    let incomplete = false;
```

Set `incomplete = true` in each of these existing branches:

```ts
        } catch (err) {
          incomplete = true;
          summary.searchErrors.push({
```

```ts
        if (found.skipped.length > 0) incomplete = true;
```

```ts
            } catch (err) {
              incomplete = true;
              summary.detailErrors.push({ course: key, error: message(err) });
```

After `parseClassRows(withUnits)`:

```ts
    if (skipped.length > 0) incomplete = true;
```

After computing `sectionsBefore`, insert this block before ratio-gate logic:

```ts
    if (incomplete) {
      summary.ok = false;
      summary.terms.push({
        termCode: term.code,
        sectionsParsed,
        sectionsBefore,
        abortedByErrors: true,
        abortedBySanityGate: false,
        persisted: null,
      });
      continue;
    }
```

Add `abortedByErrors: false` to both existing complete-term summary objects.

- [ ] **Step 5: Run full-run tests and scraper typecheck**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- run
npx pnpm --filter @csufsched/scraper-csuf typecheck
```

Expected: tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/run.ts scrapers/csuf/tests/run.test.ts
git commit -m "fix(scraper): block term persistence after partial scrape errors"
```

---

### Task 3: Fail-Closed, Unique Status Refresh

**Files:**
- Modify: `scrapers/csuf/src/statusRefresh.ts`
- Modify: `scrapers/csuf/tests/statusRefresh.test.ts`

**Interfaces:**
- Consumes: existing `SearchOutcome`.
- Produces: one unique update per class number; `sectionsObserved` equals unique,
  nonconflicting valid class numbers.
- Preserves: `refreshStatuses(deps): Promise<StatusRefreshSummary>`.

- [ ] **Step 1: Make partial-search test require zero updates**

Replace the existing `records a failed search and keeps going` test with:

```ts
  it('runs remaining searches but applies nothing after one search fails', async () => {
    const d = deps({
      search: vi
        .fn<(criteria: SearchCriteria) => Promise<SearchOutcome>>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(outcome([resultRow(0, '12345', 'C')])),
      countExistingSections: vi.fn(async () => 1),
    });

    const summary = await refreshStatuses(d);

    expect(d.search).toHaveBeenCalledTimes(2);
    expect(d.applyUpdates).not.toHaveBeenCalled();
    expect(summary.ok).toBe(false);
    expect(summary.searchErrors).toEqual([
      { subject: 'CPSC', career: 'UGRD', error: 'boom' },
    ]);
  });
```

- [ ] **Step 2: Add duplicate, conflict, HTML-skip, and invalid-status tests**

In the `deps()` defaults, change existing-count setup from four raw observations to two
unique class numbers:

```ts
    countExistingSections: vi.fn<() => Promise<number>>(async () => 2),
```

In `searches every subject x career for the one term and applies mapped statuses`, replace
the expected update list and observed count with:

```ts
    expect(d.applyUpdates).toHaveBeenCalledWith([
      { classNbr: '12345', status: 'open' },
      { classNbr: '12346', status: 'waitlist' },
    ]);
    expect(summary.sectionsObserved).toBe(2);
```

Append:

```ts
  it('deduplicates class numbers before counting and updating', async () => {
    const d = deps({
      subjects: ['CPSC'],
      careers: ['UGRD', 'PBAC'],
      search: vi.fn(async () => outcome([resultRow(0, '12345', 'O')])),
      countExistingSections: vi.fn(async () => 1),
    });

    const summary = await refreshStatuses(d);

    expect(summary.sectionsObserved).toBe(1);
    expect(d.applyUpdates).toHaveBeenCalledWith([
      { classNbr: '12345', status: 'open' },
    ]);
  });

  it('applies nothing when duplicate observations conflict', async () => {
    const d = deps({
      subjects: ['CPSC'],
      careers: ['UGRD', 'PBAC'],
      search: vi
        .fn()
        .mockResolvedValueOnce(outcome([resultRow(0, '12345', 'O')]))
        .mockResolvedValueOnce(outcome([resultRow(0, '12345', 'C')])),
      countExistingSections: vi.fn(async () => 1),
    });

    const summary = await refreshStatuses(d);

    expect(summary.ok).toBe(false);
    expect(summary.rowsSkipped[0].error).toMatch(/conflicting statuses/);
    expect(d.applyUpdates).not.toHaveBeenCalled();
  });

  it('applies nothing after an HTML result row is skipped', async () => {
    const d = deps({
      subjects: ['CPSC'],
      search: vi.fn(async () =>
        outcome([resultRow(0, '12345', 'O')], [
          { rowIndex: 9, error: 'missing status icon' },
        ])),
      countExistingSections: vi.fn(async () => 1),
    });

    const summary = await refreshStatuses(d);

    expect(summary.ok).toBe(false);
    expect(d.applyUpdates).not.toHaveBeenCalled();
  });
```

Change the existing unknown-status test final assertion to:

```ts
    expect(summary.ok).toBe(false);
    expect(d.applyUpdates).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- statusRefresh
```

Expected: failures show duplicate updates, `ok: true`, or unexpected `applyUpdates` calls.

- [ ] **Step 4: Replace update accumulation with unique fail-closed map**

In `scrapers/csuf/src/statusRefresh.ts`, replace the `updates` array declaration with:

```ts
  const updates = new Map<string, string>();
  const conflicted = new Set<string>();
  let incomplete = false;
```

In search catch, set:

```ts
        incomplete = true;
```

Before copying `found.skipped` into summary, add:

```ts
      if (found.skipped.length > 0) incomplete = true;
```

Replace the current loop body over `found.rows` with:

```ts
      for (const { row } of found.rows) {
        const status = STATUS_MAP[row.enrollment_status];
        if (status === undefined) {
          incomplete = true;
          summary.rowsSkipped.push({
            classNbr: row.class_nbr,
            error: `unknown enrollment_status "${row.enrollment_status}"`,
          });
          continue;
        }
        if (conflicted.has(row.class_nbr)) continue;
        const previous = updates.get(row.class_nbr);
        if (previous !== undefined && previous !== status) {
          incomplete = true;
          conflicted.add(row.class_nbr);
          updates.delete(row.class_nbr);
          summary.rowsSkipped.push({
            classNbr: row.class_nbr,
            error: `conflicting statuses "${previous}" and "${status}"`,
          });
          continue;
        }
        updates.set(row.class_nbr, status);
      }
```

Before reading known count, set:

```ts
  summary.sectionsObserved = updates.size;
```

After reading known count and before sanity-gate check, add:

```ts
  if (incomplete) {
    summary.ok = false;
    return summary;
  }
```

Replace final apply call with:

```ts
  summary.sectionsUpdated = await deps.applyUpdates(
    [...updates].map(([classNbr, status]) => ({ classNbr, status })),
  );
```

- [ ] **Step 5: Run status tests and typecheck**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- statusRefresh
npx pnpm --filter @csufsched/scraper-csuf typecheck
```

Expected: tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/statusRefresh.ts scrapers/csuf/tests/statusRefresh.test.ts
git commit -m "fix(scraper): fail status refresh closed on partial input"
```

---

### Task 4: Generation-Aware Session Recovery

**Files:**
- Modify: `scrapers/csuf/src/session.ts`
- Modify: `scrapers/csuf/src/searchPage.ts`
- Modify: `scrapers/csuf/src/index.ts`
- Modify: `scrapers/csuf/tests/session.test.ts`
- Modify: `scrapers/csuf/tests/searchPage.test.ts`

**Interfaces:**
- Produces:
  - `class SessionResetError extends Error`
  - `PeopleSoftSession.generation: number`
- `session.post()` reopens on expiry and throws `SessionResetError`; it never replays action.
- `makeSearcher()` retries one complete search flow after one `SessionResetError`.

- [ ] **Step 1: Replace automatic-replay session tests**

In `scrapers/csuf/tests/session.test.ts`, import `SessionResetError` and replace two expiry
tests with:

```ts
  it('reopens on expiry but never replays the stateful action', async () => {
    const replies = [
      res(entryHtml('OLD==')),
      res('<html>Your session has timed out.</html>'),
      res(entryHtml('NEW==')),
    ];
    let i = 0;
    const fetchFn = vi.fn(async () => replies[i++]);
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
```

- [ ] **Step 2: Add whole-search recovery tests**

Append to `describe('makeSearcher')` in `searchPage.test.ts`:

```ts
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
      get generation() {
        return generation;
      },
      post,
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
      generation: 1,
      post: vi.fn().mockResolvedValue(results),
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
      generation: 1,
      post: vi.fn().mockResolvedValue(results),
    };
    const search = makeSearcher(session);
    await search(criteria);

    session.generation = 2;
    await search({ ...criteria, subject: 'MATH' });

    expect(actions(session.post)).toEqual([SEARCH_ACTION, SEARCH_ACTION]);
  });

  it('propagates a second session reset', async () => {
    const session = {
      generation: 1,
      post: vi.fn(async (action: string) => {
        session.generation += 1;
        throw new SessionResetError(action);
      }),
    };

    await expect(makeSearcher(session)(criteria)).rejects.toBeInstanceOf(
      SessionResetError,
    );
    expect(session.post).toHaveBeenCalledTimes(2);
  });
```

Add `SessionResetError` import from `../src/session`.

- [ ] **Step 3: Run session/search tests and verify RED**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- session searchPage
```

Expected: compile/test failures because generation and `SessionResetError` do not exist and
session still replays expired actions.

- [ ] **Step 4: Implement session generation and typed reset**

In `scrapers/csuf/src/session.ts`, add:

```ts
export class SessionResetError extends Error {
  constructor(public readonly action: string) {
    super(`session reset while performing action ${action}`);
    this.name = 'SessionResetError';
  }
}
```

Add to `PeopleSoftSession`:

```ts
  readonly generation: number;
```

Add public field to `Session`:

```ts
  generation = 0;
```

At end of successful `open()`:

```ts
    this.generation += 1;
```

Replace `post()` expiry handling with:

```ts
  async post(action: string, fields: Record<string, string> = {}): Promise<string> {
    const html = await this.send(action, fields);
    if (!isSessionExpired(html)) return html;
    await this.open();
    throw new SessionResetError(action);
  }
```

- [ ] **Step 5: Implement whole-search retry and generation-aware reset**

Import `SessionResetError` into `searchPage.ts`:

```ts
import { SessionResetError, type PeopleSoftSession } from './session.ts';
```

Replace `makeSearcher()` with:

```ts
export function makeSearcher(
  session: PeopleSoftSession,
): (criteria: SearchCriteria) => Promise<SearchOutcome> {
  let needsReset = false;
  let resultsGeneration = session.generation;

  const attempt = async (criteria: SearchCriteria): Promise<SearchOutcome> => {
    if (needsReset) {
      if (session.generation === resultsGeneration) await resetSearch(session);
      needsReset = false;
    }
    needsReset = true;
    const html = await runSearch(session, criteria);
    needsReset = html !== null;
    resultsGeneration = session.generation;
    return html === null ? { rows: [], skipped: [] } : parseResultRows(html);
  };

  return async (criteria) => {
    try {
      return await attempt(criteria);
    } catch (err) {
      if (!(err instanceof SessionResetError)) throw err;
      needsReset = false;
      return attempt(criteria);
    }
  };
}
```

Export from `index.ts`:

```ts
export { openSession, isSessionExpired, DEFAULT_BASE_URL, SessionResetError } from './session.ts';
```

- [ ] **Step 6: Run session/search tests, full scraper tests, and typecheck**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- session searchPage
npx pnpm --filter @csufsched/scraper-csuf test
npx pnpm --filter @csufsched/scraper-csuf typecheck
```

Expected: all scraper tests PASS except opt-in/database skips; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add scrapers/csuf/src/session.ts scrapers/csuf/src/searchPage.ts \
  scrapers/csuf/src/index.ts scrapers/csuf/tests/session.test.ts \
  scrapers/csuf/tests/searchPage.test.ts
git commit -m "fix(scraper): recover expired sessions by replaying whole searches"
```

---

### Task 5: Multiple Meeting Patterns

**Files:**
- Modify: `scrapers/csuf/src/parseResults.ts`
- Modify: `scrapers/csuf/tests/parseResults.test.ts`
- Modify: `scrapers/csuf/tests/parse.test.ts`
- Modify: `scrapers/csuf/scripts/record-fixtures.ts`
- Create: `scrapers/csuf/tests/fixtures/results-multi.html`

**Interfaces:**
- `parseResultRows(html)` may emit multiple `ResultRow` values sharing one PeopleSoft
  `rowIndex` and class number.
- Each emitted `RawClassRow` carries one day/time and one paired room.
- `parseClassRows()` merges identical class numbers into one section with multiple meetings.

- [ ] **Step 1: Add inline multi-pattern parser test**

Append to `parseResults.test.ts`:

```ts
  it('expands br-separated meeting patterns and broadcasts one room', () => {
    const html = `
      <a title='Collapse section CPSC 499 - Project'>collapse</a>
      <a id='MTG_CLASS_NBR$0'>11111</a>
      <a id='MTG_CLASSNAME$0'>01-LEC<br />Regular</a>
      <span id='MTG_DAYTIME$0'>Mo 9:00AM - 9:50AM<br />We 10:00AM - 10:50AM</span>
      <span id='MTG_ROOM$0'>CS 101</span>
      <span id='FUL_STU_SS_WRK_LONGVALUE$0'>In Person</span>
      <span id='MTG_INSTR$0'>Lee,J</span>
      <div id='win0divDERIVED_CLSRCH_SSR_STATUS_LONG$0'><img alt="Open"></div>`;

    const parsed = parseResultRows(html);

    expect(parsed.skipped).toEqual([]);
    expect(parsed.rows.map(({ rowIndex, row }) => ({
      rowIndex,
      classNbr: row.class_nbr,
      days: row.meeting_days,
      start: row.start_time,
      room: row.room,
    }))).toEqual([
      { rowIndex: 0, classNbr: '11111', days: 'Mo', start: '9:00AM', room: '101' },
      { rowIndex: 0, classNbr: '11111', days: 'We', start: '10:00AM', room: '101' },
    ]);
  });

  it('skips a row whose meeting and room pattern counts disagree', () => {
    const html = `
      <a title='Collapse section CPSC 499 - Project'>collapse</a>
      <a id='MTG_CLASS_NBR$0'>11111</a>
      <a id='MTG_CLASSNAME$0'>01-LEC<br />Regular</a>
      <span id='MTG_DAYTIME$0'>Mo 9:00AM - 9:50AM<br />We 10:00AM - 10:50AM</span>
      <span id='MTG_ROOM$0'>CS 101<br />CS 102<br />CS 103</span>
      <span id='FUL_STU_SS_WRK_LONGVALUE$0'>In Person</span>
      <span id='MTG_INSTR$0'>Lee,J</span>
      <div id='win0divDERIVED_CLSRCH_SSR_STATUS_LONG$0'><img alt="Open"></div>`;

    const parsed = parseResultRows(html);

    expect(parsed.rows).toEqual([]);
    expect(parsed.skipped[0].error).toMatch(/pattern counts/);
  });
```

- [ ] **Step 2: Add downstream merge test**

Append to `parse.test.ts`:

```ts
  it('merges repeated class numbers into one section with multiple meetings', () => {
    const base: RawClassRow = {
      subject: 'CPSC',
      catalog_nbr: '499',
      descr: 'Project',
      units: '3',
      class_nbr: '11111',
      class_section: '01',
      instructor: 'Lee,J',
      meeting_days: 'Mo',
      start_time: '9:00AM',
      end_time: '9:50AM',
      building: 'CS',
      room: '101',
      instruction_mode: 'P',
      enrollment_status: 'O',
    };

    const parsed = parseClassRows([
      base,
      {
        ...base,
        meeting_days: 'We',
        start_time: '10:00AM',
        end_time: '10:50AM',
      },
    ]);

    expect(parsed.skipped).toEqual([]);
    expect(parsed.courses[0].sections).toHaveLength(1);
    expect(parsed.courses[0].sections[0].meetings).toHaveLength(2);
  });
```

Add `RawClassRow` type import if missing.

- [ ] **Step 3: Run parser tests and verify RED**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- parseResults parse
```

Expected: multi-pattern result test FAILS with one skipped row caused by unrecognized
day/time.

- [ ] **Step 4: Implement cell-line extraction and expansion**

In `parseResults.ts`, replace `fieldText` with these helpers:

```ts
function fieldInnerHtml(html: string, id: string): string {
  const m = new RegExp(
    `id='${id.replace(/\$/g, '\\$')}'[^>]*>([\\s\\S]*?)</(?:span|a)>`,
  ).exec(html);
  if (m === null) throw new Error(`field ${id} not found`);
  return m[1];
}

function fieldLines(html: string, id: string): string[] {
  const decoded = decodeEntities(
    fieldInnerHtml(html, id).replace(/<br\s*\/?>/gi, '\n'),
  ).trim();
  return decoded.split(/\r?\n/).map((line) => line.trim());
}

function fieldText(html: string, id: string): string {
  return fieldLines(html, id).join('\n');
}
```

Inside each result-row `try`, replace one-value day/time and room parsing with:

```ts
      const dayTimeLines = fieldLines(html, `MTG_DAYTIME$${rowIndex}`);
      const roomLines = fieldLines(html, `MTG_ROOM$${rowIndex}`);
      if (roomLines.length !== 1 && roomLines.length !== dayTimeLines.length) {
        throw new Error(
          `meeting/room pattern counts differ for row ${rowIndex}: ` +
          `${dayTimeLines.length}/${roomLines.length}`,
        );
      }
```

Build shared fields once:

```ts
      const header = headerFor(headers, m.index ?? 0);
      const classname = fieldText(html, `MTG_CLASSNAME$${rowIndex}`);
      const shared = {
        subject: header.subject,
        catalog_nbr: header.catalogNbr,
        descr: header.title,
        units: '',
        class_nbr: m[2],
        class_section: classname.split('\n')[0].split('-')[0].trim(),
        instructor: fieldText(html, `MTG_INSTR$${rowIndex}`),
        instruction_mode: parseMode(
          fieldText(html, `FUL_STU_SS_WRK_LONGVALUE$${rowIndex}`),
        ),
        enrollment_status: parseStatus(statusAlt(html, rowIndex)),
      };
```

Then emit each pattern:

```ts
      for (let pattern = 0; pattern < dayTimeLines.length; pattern += 1) {
        const { days, start, end } = parseDayTime(dayTimeLines[pattern]);
        const roomValue = roomLines.length === 1 ? roomLines[0] : roomLines[pattern];
        const { building, room } = parseRoom(roomValue);
        rows.push({
          rowIndex,
          row: {
            ...shared,
            meeting_days: days,
            start_time: start,
            end_time: end,
            building,
            room,
          },
        });
      }
```

Remove old single-row construction.

- [ ] **Step 5: Run parser tests and verify GREEN**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- parseResults parse
```

Expected: parser tests PASS.

- [ ] **Step 6: Add deterministic live-group extraction to recorder**

Add to `record-fixtures.ts`:

```ts
function extractMultiMeetingGroup(html: string): string {
  const row = [...html.matchAll(
    /id='MTG_DAYTIME\$\d+'[^>]*>([\s\S]*?)<\/span>/gi,
  )].find((match) => /<br\s*\/?>/i.test(match[1]));
  if (row?.index === undefined) {
    throw new Error('live CPSC results carried no multi-pattern meeting row');
  }
  const starts = [...html.matchAll(/title='Collapse section /g)]
    .map((match) => match.index ?? 0)
    .filter((offset) => offset <= row.index);
  const start = starts.at(-1);
  if (start === undefined) throw new Error('multi-pattern row has no course header');
  const next = /title='Collapse section /g;
  next.lastIndex = row.index;
  const nextMatch = next.exec(html);
  const end = nextMatch?.index ?? html.length;
  return `${html.slice(start, end)}\n<!-- verbatim live multi-pattern group -->\n`;
}
```

After writing `results-cpsc.html`, add:

```ts
  await fs.writeFile(
    path.join(OUT, 'results-multi.html'),
    extractMultiMeetingGroup(cpsc),
  );
```

- [ ] **Step 7: Record fixture and add fixture assertion**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf record-fixtures
```

Expected: command writes `results-multi.html` from full CPSC response. If current CPSC data
contains no multi-pattern row, command exits nonzero with
`live CPSC results carried no multi-pattern meeting row`; stop execution and re-record from a
live subject known to contain multiple patterns. Do not synthesize fixture markup.

Load `results-multi.html` in `parseResults.test.ts` and add:

```ts
  it('parses the recorded multi-pattern group without skipping data', () => {
    const parsed = parseResultRows(multi);
    expect(parsed.skipped).toEqual([]);
    const counts = new Map<string, number>();
    for (const { row } of parsed.rows) {
      counts.set(row.class_nbr, (counts.get(row.class_nbr) ?? 0) + 1);
    }
    expect([...counts.values()].some((count) => count > 1)).toBe(true);
  });
```

- [ ] **Step 8: Run scraper suite and typecheck**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test
npx pnpm --filter @csufsched/scraper-csuf typecheck
```

Expected: suite PASS with only database/live blocks skipped; typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
git add scrapers/csuf/src/parseResults.ts scrapers/csuf/tests/parseResults.test.ts \
  scrapers/csuf/tests/parse.test.ts scrapers/csuf/scripts/record-fixtures.ts \
  scrapers/csuf/tests/fixtures/results-multi.html
git commit -m "fix(scraper): preserve multiple section meeting patterns"
```

---

### Task 6: Existing-Term Status Mode and Validated CLI

**Files:**
- Create: `scrapers/csuf/src/statusTerm.ts`
- Create: `scrapers/csuf/tests/statusTerm.test.ts`
- Modify: `scrapers/csuf/src/cli.ts`
- Modify: `scrapers/csuf/src/index.ts`

**Interfaces:**
- Consumes: Task 1 validation functions.
- Produces:
  - `requireExistingStatusTerm(catalog, code, findId): Promise<{ id: number; term: CatalogOption }>`
- Status mode performs only a database lookup before refresh; it never upserts a term.

- [ ] **Step 1: Write failing status-term tests**

Create `scrapers/csuf/tests/statusTerm.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { requireExistingStatusTerm } from '../src/statusTerm';
import type { Catalog } from '../src/types';

const catalog: Catalog = {
  terms: [{ code: '2267', name: 'Fall 2026' }],
  subjects: [{ code: 'CPSC', name: 'Computer Science' }],
  careers: [{ code: 'UGRD', name: 'Undergraduate' }],
};

describe('requireExistingStatusTerm', () => {
  it('returns live catalog metadata plus existing database id', async () => {
    const findId = vi.fn(async () => 17);
    await expect(requireExistingStatusTerm(catalog, '2267', findId)).resolves.toEqual({
      id: 17,
      term: { code: '2267', name: 'Fall 2026' },
    });
    expect(findId).toHaveBeenCalledWith('2267');
  });

  it('rejects a term missing from live catalog without querying database', async () => {
    const findId = vi.fn(async () => 17);
    await expect(requireExistingStatusTerm(catalog, '9999', findId)).rejects.toThrow(
      /live catalog/,
    );
    expect(findId).not.toHaveBeenCalled();
  });

  it('rejects a live term missing from database', async () => {
    await expect(
      requireExistingStatusTerm(catalog, '2267', async () => null),
    ).rejects.toThrow(/database/);
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- statusTerm
```

Expected: FAIL with `Cannot find module '../src/statusTerm'`.

- [ ] **Step 3: Implement existing-term resolver**

Create `scrapers/csuf/src/statusTerm.ts`:

```ts
import { requireCatalogTerm } from './validation.ts';
import type { Catalog, CatalogOption } from './types.ts';

export async function requireExistingStatusTerm(
  catalog: Catalog,
  code: string,
  findId: (code: string) => Promise<number | null>,
): Promise<{ id: number; term: CatalogOption }> {
  const term = requireCatalogTerm(catalog, code);
  const id = await findId(code);
  if (id === null) throw new Error(`term ${code} absent from database`);
  return { id, term };
}
```

- [ ] **Step 4: Wire validated configuration and lookup into CLI**

In `cli.ts`:

1. Remove `upsertTerm` from database imports.
2. Import validation and resolver:

```ts
import {
  parseNonNegativeNumber,
  parseRatio,
  parseTermCodes,
  validateCatalog,
} from './validation.ts';
import { requireExistingStatusTerm } from './statusTerm.ts';
```

3. Replace numeric parsing:

```ts
  const rateLimitMs = parseNonNegativeNumber(
    'RATE_LIMIT_MS',
    process.env.RATE_LIMIT_MS,
    1000,
  );
  const sanityMinRatio = parseRatio(
    'SANITY_MIN_RATIO',
    process.env.SANITY_MIN_RATIO,
    0.9,
  );
```

4. After catalog parsing:

```ts
  validateCatalog(catalog);
```

5. Replace full-run term filter:

```ts
      termCodes: parseTermCodes(process.env.TERM_CODES),
```

6. Replace status-mode upsert with:

```ts
  const termCode = required('TERM_CODE').trim();
  const { id: termId } = await requireExistingStatusTerm(
    catalog,
    termCode,
    async (code) => {
      const res = await pool.query('SELECT id FROM terms WHERE code = $1', [code]);
      return res.rowCount === 0 ? null : (res.rows[0].id as number);
    },
  );
```

Remove `TERM_NAME` behavior.

- [ ] **Step 5: Export resolver**

Add to `index.ts`:

```ts
export { requireExistingStatusTerm } from './statusTerm.ts';
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npx pnpm --filter @csufsched/scraper-csuf test -- statusTerm validation
npx pnpm --filter @csufsched/scraper-csuf test
npx pnpm typecheck
```

Expected: tests PASS except opt-in/database skips; workspace typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add scrapers/csuf/src/statusTerm.ts scrapers/csuf/tests/statusTerm.test.ts \
  scrapers/csuf/src/cli.ts scrapers/csuf/src/index.ts
git commit -m "fix(scraper): require validated existing status terms"
```

---

### Task 7: Final Verification and Runtime Proof

**Files:**
- Modify only if verification exposes a defect; every defect gets a failing regression test
  before its fix.

**Interfaces:**
- Verifies all earlier task contracts together.

- [ ] **Step 1: Run formatting/diff checks**

```bash
git diff --check 2776b3a..HEAD
git status --short
```

Expected: no whitespace errors; worktree clean.

- [ ] **Step 2: Run workspace typecheck and default tests**

```bash
npx pnpm typecheck
npx pnpm test
```

Expected: typecheck exits 0; all non-opt-in tests pass.

- [ ] **Step 3: Run full PostgreSQL integration suite**

```bash
TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm test
```

Expected: database, API-query, and scraper persistence integration tests run and pass; only
live test remains skipped.

- [ ] **Step 4: Run live CSUF smoke test**

```bash
LIVE_SCRAPE=1 npx pnpm --filter @csufsched/scraper-csuf test -- live
```

Expected: session opens, CPSC results parse with zero skipped rows, and detail units parse.

- [ ] **Step 5: Prepare empty scratch database**

```bash
DATABASE_URL=postgres://localhost/csufsched_test \
  npx pnpm --filter @csufsched/db migrate
psql postgres://localhost/csufsched_test -v ON_ERROR_STOP=1 -c \
  "TRUNCATE meetings, sections, courses, prof_tags, professors, departments, terms RESTART IDENTITY CASCADE"
```

Expected: migrations current; catalog tables empty.

- [ ] **Step 6: Run first complete Fall 2026 scrape**

```bash
DATABASE_URL=postgres://localhost/csufsched_test TERM_CODES=2267 \
  npx pnpm --filter @csufsched/scraper-csuf scrape:full
```

Expected: exit 0; JSON has `ok: true`, no error arrays, one non-aborted term, and nonzero
sections.

- [ ] **Step 7: Save first-run identity snapshot and share payload**

```bash
psql postgres://localhost/csufsched_test -Atqc \
  "SELECT count(*) FROM sections;
   SELECT s.id || '|' || s.class_nbr
   FROM sections s
   JOIN courses c ON c.id = s.course_id
   JOIN terms t ON t.id = c.term_id
   WHERE t.code = '2267'
   ORDER BY s.class_nbr, s.id" \
  > /tmp/csufsched-plan5-first.txt

psql postgres://localhost/csufsched_test -Atqc \
  "SELECT t.id || '|' || min(s.id)
   FROM terms t
   JOIN courses c ON c.term_id = t.id
   JOIN sections s ON s.course_id = c.id
   WHERE t.code = '2267'
   GROUP BY t.id" \
  > /tmp/csufsched-plan5-share.txt
```

Expected: snapshot contains count plus section identities; share file contains
`term_id|section_id`.

- [ ] **Step 8: Start API and web app, then verify pre-second-run share link**

Terminal 1:

```bash
DATABASE_URL=postgres://localhost/csufsched_test PORT=3001 CORS_ORIGIN=http://localhost:5173 \
  npx pnpm --filter @csufsched/api start
```

Terminal 2:

```bash
VITE_API_URL=http://localhost:3001 npx pnpm --filter @csufsched/web dev -- --host 127.0.0.1
```

Build share hash from `/tmp/csufsched-plan5-share.txt` using app's `encodeShare` contract:

```bash
IFS='|' read -r TERM_ID SECTION_ID < /tmp/csufsched-plan5-share.txt
PAYLOAD=$(node -e \
  "const p={t:Number(process.argv[1]),s:[Number(process.argv[2])],b:[]}; process.stdout.write(Buffer.from(JSON.stringify(p)).toString('base64url'))" \
  "$TERM_ID" "$SECTION_ID")
echo "http://127.0.0.1:5173/#s=$PAYLOAD"
```

Open printed URL in in-app browser. Verify:

- no `Shared schedule could not be loaded` banner;
- selected section appears in placed schedule;
- network request `/api/sections?ids=<SECTION_ID>` returns 200.

- [ ] **Step 9: Run second complete scrape**

Keep pre-second-run share URL. Run:

```bash
DATABASE_URL=postgres://localhost/csufsched_test TERM_CODES=2267 \
  npx pnpm --filter @csufsched/scraper-csuf scrape:full
```

Expected: exit 0; JSON remains error-free.

- [ ] **Step 10: Compare stable count and ids**

```bash
psql postgres://localhost/csufsched_test -Atqc \
  "SELECT count(*) FROM sections;
   SELECT s.id || '|' || s.class_nbr
   FROM sections s
   JOIN courses c ON c.id = s.course_id
   JOIN terms t ON t.id = c.term_id
   WHERE t.code = '2267'
   ORDER BY s.class_nbr, s.id" \
  > /tmp/csufsched-plan5-second.txt
diff -u /tmp/csufsched-plan5-first.txt /tmp/csufsched-plan5-second.txt
```

Expected: `diff` exits 0 with no output.

- [ ] **Step 11: Reopen original share URL**

Reload exact URL created before second scrape. Verify selected section still loads and API
request remains 200.

- [ ] **Step 12: Request final code review**

Use `superpowers:requesting-code-review` with:

```text
Base: 2776b3a
Head: current HEAD
Requirements: docs/superpowers/specs/2026-07-30-plan-5-safety-hardening-design.md
```

Fix all Critical and Important findings through new red-green test cycles.

- [ ] **Step 13: Run final fresh verification**

```bash
npx pnpm typecheck
TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm test
LIVE_SCRAPE=1 npx pnpm --filter @csufsched/scraper-csuf test -- live
git status --short --branch
```

Expected: typecheck and tests exit 0; worktree clean.
