# CSUF Class Search Scraper Design

**Date:** 2026-07-28
**Status:** Approved
**Supersedes:** the assumed-JSON-endpoint scraper shipped in Plan 2

## Goal

Replace the CSUF scraper's placeholder JSON transport with a real scraper against CSUF's
public PeopleSoft Class Search, feeding the existing `parseClassRows` pipeline and Postgres
schema without breaking Plan 4's share links.

## Background

Plan 2 built `scrapers/csuf` against an assumed endpoint returning `RawClassRow[]` as JSON.
No such endpoint exists. This design replaces the transport with the real thing.

### Verified access recipe

Reconnaissance on 2026-07-28 confirmed a working, credential-free path. The legacy
`COMMUNITY_ACCESS.CLASS_SEARCH.GBL` path now redirects to Shibboleth SSO and is unusable.
The working entry point is:

```
https://cmsweb.fullerton.edu/psc/CFULPRD/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL?public=
```

Three requests produce a full results page:

1. **GET** the URL above. Yields a `CFULPRD-PSJSESSIONID` cookie, `ICSID` (a base64 token,
   constant for the session), and `ICStateNum=1`.
2. **POST** the search with `ICAction=CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH` and `ICStateNum=1`.
3. **POST** with `ICAction=#ICSave`, `ICSaveWarningFilter=1`, `ICStateNum=2` to clear the
   "Your search will return over 50 classes, would you like to continue?" interstitial
   (page id `SSR_SS_WARNING`). Returns page id `SSR_CLSRCH_RSLT`.

`ICStateNum` increments on every POST; `ICSID` stays fixed for the session. A verification
run for CPSC / Fall 2026 / Undergraduate returned 179 sections in ~1.5MB of HTML.

PeopleSoft rejects searches with fewer than two criteria ("Specify additional selection
criteria to narrow your search"), so every search sends subject plus a catalog-number floor.

### Form fields

Search criteria:

| Field | Value |
| --- | --- |
| `CLASS_SRCH_WRK2_INSTITUTION$31$` | `FLCMP` |
| `CLASS_SRCH_WRK2_STRM$35$` | term code, e.g. `2267` |
| `SSR_CLSRCH_WRK_SUBJECT_SRCH$0` | subject code, e.g. `CPSC` |
| `SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1` | `G` (greater than or equal) |
| `SSR_CLSRCH_WRK_CATALOG_NBR$1` | `0` |
| `SSR_CLSRCH_WRK_ACAD_CAREER$2` | `UGRD`, `PBAC`, or `EXED` |
| `SSR_CLSRCH_WRK_SSR_OPEN_ONLY$3` | `N` |

Empty-but-required companions: `SSR_CLSRCH_WRK_CRSE_ATTR$4`,
`SSR_CLSRCH_WRK_CRSE_ATTR_VALUE$4`, `SSR_CLSRCH_WRK_LOCATION$5`, `SSR_CLSRCH_WRK_DESCR$6`.

Constant PeopleSoft envelope fields sent on every POST: `ICAJAX=1`, `ICNAVTYPEDROPDOWN=0`,
`ICType=Panel`, `ICElementNum=0`, `ICXPos=0`, `ICYPos=0`, `ResponsetoDiffFrame=-1`,
`TargetFrameName=None`, `FacetPath=None`, `ICFocus=`, `ICChanged=-1`, `ICSkipPending=0`,
`ICAutoSave=0`, `ICResubmit=0`, `ICActionPrompt=false`, `ICBcDomData=`, `ICFind=`,
`ICAddCount=`, `ICAppClsData=`.

### Available data

The entry page's dropdowns enumerate everything worth iterating: terms
(`2267` Fall 2026, `2265` Summer 2026), 91 subjects with full names ("CPSC" → "Computer
Science"), and three careers (`UGRD`, `PBAC`, `EXED`). This removes the need for a hardcoded
`DEPARTMENTS` env var and supplies real department names, which the current scraper fakes by
reusing the department code.

The results page carries class number, section code, days and times, room, instruction mode,
instructor, meeting dates, and status. Status is an image: `PS_CS_STATUS_OPEN_ICN_1.gif` with
`alt="Open"`, and equivalents for Closed and Wait List.

**Units are absent from the results page.** They appear only on the per-section detail page
(`ICAction=MTG_CLASS_NBR$N`, page id `SSR_CLSRCH_DTL`, ~34KB), alongside class capacity,
enrollment total, wait list totals, enrollment requirements, and final exam schedule.

## Decisions

| Decision | Choice | Reasoning |
| --- | --- | --- |
| Transport | Plain HTTP + HTML parse | The flow needs no JavaScript. Headless Playwright costs 2-5s per request versus ~50ms and hundreds of MB of RAM, buying robustness against a risk the transactional swap already covers. |
| Units source | One detail page per course | Units are a course attribute, so one fetch per course (~1,300) suffices instead of one per section (~5,000). |
| Cadence | Nightly full run, hourly status-only refresh | Open/closed churns fast during registration; course and unit data does not. |
| Failure policy | Transactional, all-or-nothing, with a sanity gate | A markup change should leave yesterday's good data in place, not gut the catalog. |
| Hosting | User's own server | Scraper, cron, and Postgres colocated. One `DATABASE_URL`, no secrets in transit. |
| Authentication | None | Class Search is public. Student login gates app access only and is deferred to Plan 6. |

## Architecture

`RawClassRow` remains the contract between transport and pipeline. `parse.ts`
(`parseClassRows`, `parseDays`, `parseTime`) and `rateLimit.ts` are already tested and stay
untouched. This design replaces the transport and adds an HTML-to-`RawClassRow` step.

### New modules in `scrapers/csuf/src/`

**`session.ts`** — Owns one PeopleSoft session. `openSession()` performs the GET, keeps a
cookie jar, extracts `ICSID`, seeds `stateNum = 1`. Exposes `post(action, fields) => html`,
incrementing `stateNum` per call. Detects the session-expiry page, reopens once, and retries.
No other module knows `ICSID` exists.

**`forms.ts`** — Pure function building the constant envelope plus search criteria into a
form payload.

**`catalog.ts`** — Parses the entry page's dropdowns into terms, subjects, and careers.

**`searchPage.ts`** — Executes one search: POST criteria, detect the `SSR_SS_WARNING`
interstitial, auto-continue with `#ICSave` and `ICSaveWarningFilter=1`, return results HTML.
Treats "no classes found" as an empty result, not an error.

**`parseResults.ts`** — Results HTML to `RawClassRow[]`. Maps the status icon to `O`/`C`/`W`,
`MoWe 8:30AM - 9:20AM` to the existing day and time fields, and `E 202 - Lecture Room` to
building and room.

**`detail.ts`** — Fetches and parses one section detail page per course, extracting units.

**`statusRefresh.ts`** — The hourly list-only pass. Updates `enrollment_status` only.

**`run.ts`** — Rewritten orchestration: iteration, sanity gate, transaction.

### Change outside the scraper

`db/src/upserts.ts` currently takes `pg.Pool`. The transactional swap needs every write on a
single client, so the upsert functions widen to accept `Pool | PoolClient` via a `Queryable`
interface exposing `query`. Signature-compatible; no existing call site changes.

A new `updateSectionStatuses(client, termId, updates)` performs a batched
`UPDATE sections SET enrollment_status = ... FROM (VALUES ...)` for the hourly pass.

## Data flow

### Nightly full run

1. `openSession()`.
2. `catalog.ts` reads the dropdowns for terms, subjects, and careers.
3. Loop term x subject x career. Each search is one or two POSTs depending on whether the
   over-50 interstitial fires. Roughly 550 searches, ~1,100 requests.
4. Group rows into courses. Fetch one detail page per course for units, cached by
   (term, dept, catalog number) so the three careers do not refetch. ~1,300 requests.
5. `parseClassRows()` converts rows to `ScrapedCourse[]`.
6. **Sanity gate**, before any write: compare the parsed section count against the current
   database count for that term. Abort the run if the ratio falls below `SANITY_MIN_RATIO`
   (default 0.9). A first run against an empty database passes.
7. Persist inside a single transaction.

At one request per second, a full run takes roughly 40 minutes. Rate limiting and retry
come from the existing `rateLimited` and `fetchWithBackoff`.

### Persistence: upsert and prune

Delete-then-insert would break Plan 4's share links, which encode `placedSectionIds` into
share URLs. Reinserting sections nightly would issue new ids and rot every shared schedule
within 24 hours.

Instead, within one transaction:

1. Upsert the term and all departments (with their real names from the subject dropdown).
2. Upsert courses on `(term_id, dept_id, catalog_nbr)` — already UNIQUE in the schema.
3. Upsert sections on `(course_id, class_nbr)` — already UNIQUE, and `class_nbr` is
   PeopleSoft's own stable identifier.
4. Replace meetings for each upserted section.
5. Delete only the courses and sections this run did not observe for that term.
6. Commit.

Section ids survive for anything still offered. The API never observes a half-written
catalog because readers use separate connections and see the pre-commit snapshot.

### Hourly status refresh

Same search loop, list-only, no detail fetches, **current term only** — roughly 550 requests,
about 9 minutes. Parses class number and status, then applies a batched update inside its own
transaction. Its own gate aborts if it observes fewer than `SANITY_MIN_RATIO` of the sections
already known for that term.

### Operations

Two cron entries on the server: one nightly full run, one hourly status refresh.

Environment: `DATABASE_URL`, `CSUF_BASE_URL` (defaults to the verified URL), `RATE_LIMIT_MS`
(default 1000), `SANITY_MIN_RATIO` (default 0.9).

## Testing

Fixtures recorded from the live site: entry page, warning interstitial, results page, and
detail page. The results fixture is trimmed to roughly 12 sections covering async and online
sections with no days or times, TBA rooms, "Staff" instructors, closed and wait list statuses,
a section with two meeting patterns, and a lab component.

- **Parsers** (`parseResults`, `detail`, `catalog`, `forms`) — pure functions against
  fixtures. No network.
- **`session.ts`** — injected `FetchLike` (the type already exists in `rateLimit.ts`).
  Covers `ICSID` extraction, state increment, warning auto-continue, and expiry
  reopen-and-retry.
- **`run.ts`** — dependency-injected as it already is via `ScrapeTermOptions`, with fake
  search, detail, and persist functions. Key case: a sanity gate below threshold aborts with
  zero writes.
- **Upsert and prune** — requires a real database, gated behind `TEST_DATABASE_URL` and
  skipped without it, matching Plan 3. Asserts that section ids survive a re-scrape, which is
  the share-link guarantee.
- **Live smoke test** — opt-in behind `LIVE_SCRAPE=1`, asserts a real CPSC search returns
  sections. Excluded from CI.

A `record-fixtures` script re-captures all four fixtures in one command when CSUF changes
markup.

## Failure handling

A single failed search exhausts its backoff retries, lands in the run summary, and the loop
continues. Unparseable rows go to `rowsSkipped` as they do today. The only whole-run abort is
the sanity gate, which exits nonzero so cron mails the operator.

## Out of scope

- Student authentication and saved schedules (Plan 6).
- Per-section seat counts. Plan 4's UI shows only open, closed, or wait list, which the
  results-page icon already provides.
- Prerequisites, course descriptions, and final exam schedules. Available on detail pages but
  unused by the current UI.
