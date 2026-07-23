# CSUF Schedule Builder — Design

**Date:** 2026-07-23
**Status:** Approved

## Overview

A public web app for CSUF students to build semester schedules. Students search the class catalog, paint busy times onto a weekly calendar, drag class sections onto the grid, and use a form-based solver to generate ranked, conflict-free schedule candidates. Professor quality data (RateMyProfessors ratings and tags like "Lots of homework") is surfaced throughout.

## Decisions

| Question | Decision |
|---|---|
| Audience | Public web app for CSUF students |
| Class data | Semester snapshot scraped from CSUF PeopleSoft class search; manual re-runs. No live seat counts — students verify on Titan Online. |
| Professor data | RateMyProfessors unofficial GraphQL: rating, difficulty, would-take-again %, student-voted tags. No LLM summaries in v1. |
| Schedule generation | Form-based constraint solver in v1. LLM natural-language parsing is a possible later addition (LLM → same constraint object → same solver). |
| Course selection | Specific courses only in v1. GE-area placeholders ("any C1") deferred. |
| Solver output | Top 3–5 ranked candidates with explanations. |
| Persistence | No accounts. localStorage autosave + share links (URL-encoded). |
| Layout | Layout A: course search sidebar left, weekly calendar right. |
| Stack | React + TypeScript + Vite + Tailwind CSS; Fastify API; PostgreSQL; Node/TS scrapers. |
| Solver location | Client-side (pure TS package, importable server-side later if needed). |

### Why client-side solver

Solver input after course selection is tiny (~15k combos worst case for 6 courses × 5 sections); JS solves in milliseconds. Instant re-solve on every busy-block tweak is the core UX. Zero server scaling cost at registration week. Nothing proprietary to protect. The solver package has no browser dependencies, so a future server endpoint (GE placeholder search, LLM tooling) can reuse it unchanged.

## Architecture

```
CSUF PeopleSoft class search ─┐
                              ├─ scrapers (Node+TS, per semester) → PostgreSQL
RateMyProfessors GraphQL ─────┘
PostgreSQL → Fastify read-only API → React SPA (solver runs in browser)
```

### Repo layout (monorepo)

```
CSUFsched/
  apps/
    web/        React SPA (Vite, Tailwind)
    api/        Fastify read-only API
  packages/
    solver/     pure TS constraint solver (no runtime deps)
    types/      shared TS types (Course, Section, Meeting, Professor, ...)
  scrapers/
    csuf/       PeopleSoft catalog scraper
    rmp/        RateMyProfessors scraper + name matcher
  db/           schema migrations, seed scripts
```

## Data pipeline

### PostgreSQL schema

```
terms          id, code (e.g. "2268"), name ("Fall 2026")
departments    id, code ("CPSC"), name
courses        id, dept_id, term_id, catalog_nbr ("121"), title, units, description
sections       id, course_id, class_nbr (5-digit CSUF), section_code ("01"),
               instructor_id, mode (in-person/online/hybrid),
               enrollment_status ("open"/"closed"/"waitlist" at scrape time)
meetings       id, section_id, days ("MWF"), start_time, end_time, building, room
professors     id, full_name, rmp_id, rating, difficulty, would_take_again_pct,
               num_ratings, rmp_url, last_scraped_at
prof_tags      professor_id, tag ("Lots of homework"), count
```

`meetings` is separate from `sections` because a section can have multiple meeting patterns (lecture + lab). The solver treats every meeting row as a time blocker.

### CSUF scraper

- Hits PeopleSoft class-search endpoints per department for a term; parses courses, sections, meeting patterns; upserts into Postgres.
- Idempotent and re-runnable; safe to refresh mid-semester.
- Polite rate limiting (~1 req/sec with backoff).
- Failures log and skip the record, never abort the run; end-of-run summary report (counts, skips).

### RMP scraper

- Unofficial GraphQL endpoint, filtered to school = CSUF.
- Pulls rating, difficulty, would-take-again %, top tags with vote counts.
- Name matching: CSUF format "Lee,J" vs RMP "John Lee" — match last name + first initial within CSUF school scope. Ambiguous matches written to a report file for manual resolution. Unmatched professors display with no rating (UI handles null).

### Freshness

Scrape when the semester schedule drops; manual re-runs as desired. `last_scraped_at` surfaced in the UI footer ("Data from Jul 20").

## API (Fastify, read-only)

```
GET /api/terms                          → active terms
GET /api/terms/:termId/departments      → department list
GET /api/terms/:termId/courses?dept=CPSC&q=121
                                        → courses + nested sections + meetings + prof summary
GET /api/professors/:id                 → full RMP detail (tags, counts, url)
GET /api/sections?ids=1,2,3             → resolve share-link section IDs
```

- Course responses embed everything the solver needs; one fetch per department, cached client-side and via `Cache-Control: max-age=7200` (2 hours).
- No auth, no writes, no server-side user data. CORS locked to app origin. Basic rate-limit middleware.
- Errors: JSON `{error, message}`. Unknown term/section → 404; stale share links get a friendly "this schedule references an old semester" UI.

## Frontend (React + Vite + TS + Tailwind)

Layout A: course search sidebar left, weekly calendar right.

### Components

- **CalendarGrid** — Mon–Sat columns, 7am–10pm rows, 15-minute snap. Renders section blocks, busy blocks, drag ghost previews.
- **BusyPainter** — drag on empty grid paints a busy block; click a busy block to delete it.
- **CourseSearch** (sidebar) — department picker + text search; results grouped by course; sections expandable showing days/times, professor name, ★rating, top 2 tags.
- **SectionCard** — draggable. Dropping on the calendar adds the section at its real meeting times (fixed by the university). Grid shows a ghost of where it lands; conflicts render a red ghost and the drop is rejected. Swapping = drop a different section of the same course.
- **SolverPanel** — wanted-courses list, unit counter (warn above 18, allow anyway — pardon case), preferences (avoid days, earliest start / latest end, professor-rating weight, minimize-gaps weight), Generate button → top 5 candidates as mini-calendar thumbnails; clicking one loads it onto the grid.
- **ProfPopover** — hover any professor name → rating, difficulty, would-take-again %, tags.
- **ShareBar** — copy share link (URL-encoded term + section IDs + busy blocks), export .ics.

### State

Zustand store. Autosave entire store to localStorage on change; hydrate on load. Opening a share link decodes into a fresh store. Drag-drop via `@dnd-kit/core`.

## Solver (`packages/solver`, pure TS)

### Input

```ts
{
  courses: CourseWithSections[],
  busyBlocks: TimeBlock[],
  lockedSections: SectionId[],
  prefs: {
    avoidDays: Day[],
    earliestStart?: number,   // minutes from midnight
    latestEnd?: number,
    maxUnits: number,         // default 18, overridable
    weightProfRating: number, // 0–1
    weightMinimizeGaps: number, // 0–1
  }
}
```

### Algorithm

1. Filter sections violating busy blocks, avoided days, time window, or locked-section conflicts.
2. Backtracking over courses, fewest-sections-first ordering (fastest pruning). Conflict check = interval overlap per day across all meeting rows.
3. Collect valid combos, cap ~2000 with early bail (sufficient for ranking).
4. Score: weighted sum of average professor rating (unrated = neutral 3.0), total gap minutes, days-on-campus count.
5. Return top 5 with explanation strings ("No Fridays · avg prof ★4.1 · 45 min total gaps").

### Failure modes

Zero valid combos → the solver reports which course had all sections eliminated and by what constraint (busy block, day filter, or pairwise conflict). UI renders actionable messages, e.g. "MATH 150B: all 4 sections conflict with your Tuesday busy block."

Over 18 units: warning banner, solver still runs.

## Error handling & testing

- **Solver:** Vitest unit tests — conflict detection, backtracking correctness, scoring, zero-result explanations.
- **Scrapers:** fixture-based tests (saved HTML/JSON responses); parser unit tests; per-record failure isolation with end-of-run summaries.
- **API:** integration tests against a test database.
- **Web:** component tests for SolverPanel and calendar interactions; Playwright smoke test of the golden path (search → add section → paint busy → generate → share-link roundtrip).
- **App-level:** API down → serve cached catalog from localStorage with a banner; designed empty states (no term data, no search results).

## Out of scope (v1)

- Accounts / server-side user data
- Live seat counts
- GE-area placeholder solving
- LLM natural-language constraint parsing
- LLM professor review summaries
