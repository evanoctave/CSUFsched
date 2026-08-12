# CSUF Major Roadmaps and Titan UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CSUF students choose a 2026–2027 degree major, select a roadmap semester, schedule only source-backed current-term roadmap and GE courses, and view the program's official roadmap beside a CSUF-branded weekly calendar.

**Architecture:** A reviewed web-side major registry holds official roadmap requirements and source URLs. A new transactional GE ingestion path stores official catalog-year area tags in Postgres, while a read-only API route resolves exact roadmap course codes and approved GE options against the selected class term. The web app replaces raw department discovery with a major planner, roadmap panel, and Titan design tokens while preserving the current solver, drag/drop, sharing, and ICS contracts.

**Tech Stack:** TypeScript, React 19, Vite 6, Tailwind CSS 4, Zustand, Fastify 5, PostgreSQL 16, Vitest, Playwright, Cheerio.

**Spec:** `docs/superpowers/specs/2026-08-12-major-roadmaps-ui-design.md`

## Global Constraints

- Use only 2026–2027 official CSUF program sources; do not infer, transform, or substitute missing requirements.
- Use `https://csu-fullerton.preview.programmapper.com/academics` for every major without a published, verified 2026–2027 PDF.
- Use `https://www.fullerton.edu/general-education/student-info/approved-courses.html` as the Fall 2025-and-later GE source.
- Preserve the last complete GE snapshot when fetch or parse fails. Never replace it with an empty or partial set.
- Keep the app a planning aid: display `Planning guide only. Verify your Titan Degree Audit and adviser.` beside pathway guidance.
- Use Titan Blue `#00244E` for structure, Titan Orange `#FF7900` only as a small accent, Beige `#F8F7F3`, Light Gray `#F5F5F5`, and Text `#222222`.
- Meet WCAG 2.2 AA. All controls must work by keyboard, selected state cannot rely on color alone, and every roadmap preview needs an official-source link.
- Do not alter solver, drag/drop, sharing, or ICS behavior except wiring them to roadmap-loaded courses.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `db/migrations/002_ge_course_areas.sql` | Catalog-year GE tags and source metadata. |
| `db/src/ge.ts` | Transactional GE snapshot replacement and query types. |
| `db/src/index.ts` | Public GE persistence exports. |
| `db/tests/ge.test.ts` | Integration coverage for GE replace and rollback safety. |
| `scrapers/csuf/src/ge.ts` | Parse official Fall 2025+ GE source into validated rows. |
| `scrapers/csuf/src/geRefresh.ts` | Fetch, parse, validate, and persist a complete GE snapshot. |
| `scrapers/csuf/src/types.ts` | GE parser and refresh interfaces. |
| `scrapers/csuf/src/cli.ts` | Run GE refresh in full catalog refresh and report its status. |
| `scrapers/csuf/tests/fixtures/ge-f2025.html` | Stable official-source-shaped GE fixture. |
| `scrapers/csuf/tests/ge.test.ts` | Parser coverage for valid and malformed GE data. |
| `scrapers/csuf/tests/geRefresh.test.ts` | Failure-safe refresh orchestration coverage. |
| `packages/types/src/index.ts` | Shared `RoadmapCoursesResponse` and `GeSourceMeta` API types. |
| `apps/api/src/queries.ts` | Exact-course and GE-area roadmap query. |
| `apps/api/src/app.ts` | Validated roadmap-courses route. |
| `apps/api/tests/queries.test.ts` | Database-backed route query coverage. |
| `apps/api/tests/app.test.ts` | Request validation and API contract coverage. |
| `apps/web/src/data/majorPlans.ts` | Reviewed 2026–2027 major roadmap registry. |
| `apps/web/src/data/majorPlans.test.ts` | Registry shape and source integrity coverage. |
| `apps/web/src/lib/roadmap.ts` | Query serialization, result matching, and unavailable requirement state. |
| `apps/web/src/lib/roadmap.test.ts` | Pure roadmap helper coverage. |
| `apps/web/src/lib/api.ts` | Typed roadmap-courses request. |
| `apps/web/src/store.ts` | Persisted selected major and roadmap semester. |
| `apps/web/src/components/MajorPlanner.tsx` | Major picker, semester tabs, requirement list, and solver actions. |
| `apps/web/src/components/RoadmapPanel.tsx` | PDF preview or Program Mapper fallback and planning notice. |
| `apps/web/src/components/MajorPlanner.test.tsx` | Major planner interactions and unavailable states. |
| `apps/web/src/components/RoadmapPanel.test.tsx` | Preview, source link, and fallback coverage. |
| `apps/web/src/App.tsx` | Responsive three-region workspace shell. |
| `apps/web/src/index.css` | Titan design tokens, component states, responsive layout, reduced-motion rules. |
| `apps/web/tests/app.test.tsx` | Updated app data wiring and major persistence coverage. |
| `apps/web/e2e/smoke.spec.ts` | Major-first end-to-end flow. |
| `apps/web/e2e/fixtures.ts` | Major roadmap and GE API fixtures. |

## Task 1: Shared roadmap response types and GE persistence

**Files:**

- Create: `db/migrations/002_ge_course_areas.sql`
- Create: `db/src/ge.ts`
- Modify: `db/src/index.ts`
- Modify: `packages/types/src/index.ts`
- Create: `db/tests/ge.test.ts`
- Modify: `db/tests/migrate.test.ts`

**Interfaces:**

- Consumes: existing `Queryable` and `createPool` from `db/src/upserts.ts` and `db/src/pool.ts`.
- Produces: `replaceGeCourseAreas(db, input)`, `GeCourseAreaInput`, `GeSourceMeta`, and `RoadmapCoursesResponse` for scraper and API tasks.

- [ ] **Step 1: Write failing migration and persistence tests**

Create `db/tests/ge.test.ts` using the scratch-schema pattern from `db/tests/upserts.test.ts`. Test these exact cases:

```ts
await replaceGeCourseAreas(pool, {
  catalogYear: '2026-2027',
  sourceUrl: 'https://www.fullerton.edu/general-education/student-info/approved-courses.html',
  sourcePublishedAt: new Date('2026-03-25T00:00:00Z'),
  rows: [
    { area: '1A', subject: 'ENGL', catalogNbr: '101' },
    { area: '3', subject: 'ART', catalogNbr: '101' },
  ],
});
```

Assert both rows persist, a second complete snapshot removes an obsolete `ART 101` row, duplicate input throws `Duplicate GE course area`, and an empty `rows` array throws `GE snapshot must contain at least one row` without deleting prior rows.

- [ ] **Step 2: Run the new database test and verify red**

Run: `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/db test -- ge.test.ts`

Expected: FAIL because the migration, types, and `replaceGeCourseAreas` export do not exist.

- [ ] **Step 3: Add the GE schema and transactional replacement function**

Create migration `002_ge_course_areas.sql`:

```sql
CREATE TABLE ge_course_areas (
  catalog_year TEXT NOT NULL,
  area TEXT NOT NULL,
  subject TEXT NOT NULL,
  catalog_nbr TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_published_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (catalog_year, area, subject, catalog_nbr)
);

CREATE INDEX idx_ge_course_areas_lookup
  ON ge_course_areas (catalog_year, area, subject, catalog_nbr);
```

In `db/src/ge.ts`, validate nonempty rows and de-duplicate keys before opening a transaction. Insert every row into `ge_course_areas` with the source metadata, then delete only rows for the same `catalog_year` whose `(area, subject, catalog_nbr)` key is absent from the complete input snapshot. Roll back on every error.

Export:

```ts
export interface GeCourseAreaInput { area: string; subject: string; catalogNbr: string }
export interface GeSnapshotInput {
  catalogYear: string;
  sourceUrl: string;
  sourcePublishedAt: Date;
  rows: GeCourseAreaInput[];
}
export async function replaceGeCourseAreas(pool: pg.Pool, input: GeSnapshotInput): Promise<void>
```

Append these shared API types to `packages/types/src/index.ts`:

```ts
export interface GeSourceMeta { sourceUrl: string; sourcePublishedAt: string }
export interface RoadmapCoursesResponse {
  courses: CourseWithSections[];
  geSource: GeSourceMeta | null;
}
```

Export GE types and `replaceGeCourseAreas` from `db/src/index.ts`.

- [ ] **Step 4: Extend migration inventory coverage**

Update the expected table list in `db/tests/migrate.test.ts` to include `ge_course_areas`. Keep the test's sorted-table assertion deterministic.

- [ ] **Step 5: Run database tests and typechecks**

Run: `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/db test`

Expected: PASS, including GE snapshot replacement and preservation tests.

Run: `npx pnpm --filter @csufsched/db typecheck && npx pnpm --filter @csufsched/types typecheck`

Expected: PASS.

- [ ] **Step 6: Commit GE persistence**

```bash
git add db/migrations/002_ge_course_areas.sql db/src/ge.ts db/src/index.ts db/tests/ge.test.ts db/tests/migrate.test.ts packages/types/src/index.ts
git commit -m "feat: store verified GE course areas"
```

## Task 2: Official GE parser and failure-safe refresh

**Files:**

- Create: `scrapers/csuf/src/ge.ts`
- Create: `scrapers/csuf/src/geRefresh.ts`
- Modify: `scrapers/csuf/src/types.ts`
- Modify: `scrapers/csuf/src/cli.ts`
- Create: `scrapers/csuf/tests/fixtures/ge-f2025.html`
- Create: `scrapers/csuf/tests/ge.test.ts`
- Create: `scrapers/csuf/tests/geRefresh.test.ts`

**Interfaces:**

- Consumes: `replaceGeCourseAreas` from Task 1, `fetchWithBackoff` from `src/rateLimit.ts`, and the official GE source URL.
- Produces: `parseGeCourseAreas(html)`, `refreshGeCourseAreas(deps)`, and `GeRefreshSummary` for CLI reporting.

- [ ] **Step 1: Write the parser fixture and failing parser tests**

Create a small fixture matching the official Fall-2025-and-later source's category chooser. Include `1A`, `3`, and `Z` groups with rows `ENGL 101`, `ART 101`, and `HIST 190`. Write tests asserting:

```ts
expect(parseGeCourseAreas(html)).toEqual([
  { area: '1A', subject: 'ENGL', catalogNbr: '101' },
  { area: '3', subject: 'ART', catalogNbr: '101' },
  { area: 'Z', subject: 'HIST', catalogNbr: '190' },
]);
expect(() => parseGeCourseAreas('<main><h2>Approved General Education Courses</h2></main>'))
  .toThrow('No Fall 2025+ GE courses found');
```

- [ ] **Step 2: Run parser test and verify red**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- ge.test.ts`

Expected: FAIL because `parseGeCourseAreas` is not exported.

- [ ] **Step 3: Implement strict GE parsing**

In `src/ge.ts`, use the existing Cheerio dependency. Parse only category sections marked with the Fall-2025-and-later area names. Normalize subject codes to uppercase, preserve catalog suffixes such as `101A`, and reject rows without both values. Throw when no valid rows remain or when the parsed key set contains duplicates. Export:

```ts
export const GE_SOURCE_URL = 'https://www.fullerton.edu/general-education/student-info/approved-courses.html';
export const GE_CATALOG_YEAR = '2026-2027';
export function parseGeCourseAreas(html: string): GeCourseAreaInput[];
```

- [ ] **Step 4: Write failing refresh tests**

In `geRefresh.test.ts`, inject `fetchPage`, `persist`, and `now`. Assert a valid response calls `persist` exactly once with `GE_CATALOG_YEAR`, the official source URL, parsed rows, and `sourcePublishedAt`. Assert a rejected fetch or parser error returns `{ ok: false, rows: 0, error: '...' }` and never calls `persist`.

- [ ] **Step 5: Implement the refresh orchestration**

Create `refreshGeCourseAreas`:

```ts
export interface GeRefreshDeps {
  fetchPage: () => Promise<{ html: string; publishedAt: Date }>;
  persist: (input: GeSnapshotInput) => Promise<void>;
}
export interface GeRefreshSummary { ok: boolean; rows: number; error: string | null }
export async function refreshGeCourseAreas(deps: GeRefreshDeps): Promise<GeRefreshSummary>
```

The function parses before persisting. Return a failure summary for fetch, parse, or persist failure. Do not catch an error and continue to a destructive write.

In `cli.ts`, when `mode === 'full'`, run GE refresh through the same rate-limited fetch infrastructure, print its summary under `ge`, and set the process failure result when `ge.ok` is false. Continue catalog work so a temporary GE-source outage does not prevent normal catalog freshness; GE rows remain unchanged because persistence never ran.

- [ ] **Step 6: Run scraper tests and typecheck**

Run: `npx pnpm --filter @csufsched/scraper-csuf test -- ge.test.ts geRefresh.test.ts`

Expected: PASS.

Run: `npx pnpm --filter @csufsched/scraper-csuf typecheck`

Expected: PASS.

- [ ] **Step 7: Commit GE refresh**

```bash
git add scrapers/csuf/src/ge.ts scrapers/csuf/src/geRefresh.ts scrapers/csuf/src/types.ts scrapers/csuf/src/cli.ts scrapers/csuf/tests/fixtures/ge-f2025.html scrapers/csuf/tests/ge.test.ts scrapers/csuf/tests/geRefresh.test.ts
git commit -m "feat: refresh approved GE course areas"
```

## Task 3: Resolve roadmap courses through the API

**Files:**

- Modify: `apps/api/src/queries.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/tests/queries.test.ts`
- Modify: `apps/api/tests/app.test.ts`

**Interfaces:**

- Consumes: `ge_course_areas` from Task 1 and `RoadmapCoursesResponse` from Task 1.
- Produces: `ApiQueries.listRoadmapCourses(termId, courseRefs, geAreas)` and `GET /api/terms/:termId/roadmap-courses`.

- [ ] **Step 1: Add failing query-layer tests**

In `apps/api/tests/queries.test.ts`, seed `ge_course_areas` with `ART 101` for area `3` and catalog year `2026-2027`. Test:

```ts
const result = await q.listRoadmapCourses(termId, [{ subject: 'CPSC', catalogNbr: '121' }], ['3']);
expect(result.courses.map((course) => `${course.deptCode} ${course.catalogNbr}`).sort())
  .toEqual(['ART 101', 'CPSC 121']);
expect(result.geSource).toEqual({
  sourceUrl: 'https://www.fullerton.edu/general-education/student-info/approved-courses.html',
  sourcePublishedAt: '2026-03-25T00:00:00.000Z',
});
```

Add a second assertion that a course matching an exact reference and a GE area appears once.

- [ ] **Step 2: Add failing route contract tests**

In `apps/api/tests/app.test.ts`, extend `stubQueries` with `listRoadmapCourses`. Assert that `/api/terms/1/roadmap-courses?courses=CPSC:121,MATH:150A&geAreas=1A,3` passes:

```ts
[1, [{ subject: 'CPSC', catalogNbr: '121' }, { subject: 'MATH', catalogNbr: '150A' }], ['1A', '3']]
```

Assert these requests return `400`:

```txt
/api/terms/1/roadmap-courses
/api/terms/1/roadmap-courses?courses=CPSC121
/api/terms/1/roadmap-courses?geAreas=1A,,3
```

- [ ] **Step 3: Run API tests and verify red**

Run: `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/api test -- queries.test.ts app.test.ts`

Expected: FAIL because `listRoadmapCourses` and the route do not exist.

- [ ] **Step 4: Implement exact and GE course resolution**

Add these exports in `queries.ts`:

```ts
export interface RoadmapCourseRef { subject: string; catalogNbr: string }
async listRoadmapCourses(
  termId: number,
  courseRefs: RoadmapCourseRef[],
  geAreas: string[],
): Promise<RoadmapCoursesResponse>;
```

Use one course query selecting current-term rows where `(d.code, c.catalog_nbr)` is one requested reference or where an `EXISTS` subquery matches `ge_course_areas` for catalog year `2026-2027` and a requested area. Reuse `SECTION_SELECT` and `fetchMeetingsAndTags`; de-duplicate on `c.id` before assembly. Query `MAX(source_published_at)` and its matching `source_url` only when `geAreas.length > 0`; return `geSource: null` for exact-only requests.

In `app.ts`, parse comma-separated values with trimming, reject empty segments, validate exact references with `/^[A-Z]{2,8}:[A-Z0-9]+$/`, validate GE areas with `/^(1A|1B|1C|2A|3|4|5A|5B|6|Z)$/`, and check `termExists` before calling the query layer.

- [ ] **Step 5: Run API tests and typecheck**

Run: `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/api test`

Expected: PASS with exact references, GE results, de-duplication, and malformed query rejection covered.

Run: `npx pnpm --filter @csufsched/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit roadmap API**

```bash
git add apps/api/src/queries.ts apps/api/src/app.ts apps/api/tests/queries.test.ts apps/api/tests/app.test.ts
git commit -m "feat: expose roadmap course choices"
```

## Task 4: Build and validate the 2026–2027 major registry

**Files:**

- Create: `apps/web/src/data/majorPlans.ts`
- Create: `apps/web/src/data/majorPlans.test.ts`
- Create: `apps/web/src/lib/roadmap.ts`
- Create: `apps/web/src/lib/roadmap.test.ts`

**Interfaces:**

- Consumes: `CourseWithSections` from shared types and source URLs defined in each registry entry.
- Produces: `MAJOR_PLANS`, `MajorPlan`, `RoadmapRequirement`, `toRoadmapRequest`, and `matchRequirements` for UI tasks.

- [ ] **Step 1: Create failing registry validation tests**

Define a test helper that validates every `MAJOR_PLANS` entry. Assert exact conditions:

```ts
expect(MAJOR_PLANS.map((plan) => plan.id)).toEqual(expect.arrayContaining(['computer-science-bs']));
expect(new Set(MAJOR_PLANS.map((plan) => plan.id)).size).toBe(MAJOR_PLANS.length);
for (const plan of MAJOR_PLANS) {
  expect(plan.catalogYear).toBe('2026-2027');
  expect(plan.programMapperUrl).toBe('https://csu-fullerton.preview.programmapper.com/academics');
  expect(plan.semesters.map((semester) => semester.id)).toEqual([
    'y1-fall', 'y1-spring', 'y2-fall', 'y2-spring',
    'y3-fall', 'y3-spring', 'y4-fall', 'y4-spring',
  ]);
}
```

Add a Computer Science first-semester expectation that includes course options `CPSC 120A`, `CPSC 120L`, and `MATH 150A` plus its source-backed GE requirement. Test the helper rejects an empty source date, a nonofficial source host, a duplicate semester id, and an empty course option set.

- [ ] **Step 2: Run registry tests and verify red**

Run: `npx pnpm --filter @csufsched/web test -- majorPlans.test.ts roadmap.test.ts`

Expected: FAIL because the registry and helpers do not exist.

- [ ] **Step 3: Add the registry types and CPSC reference entry**

Put `CourseRef`, `RoadmapRequirement`, `RoadmapSemester`, and `MajorPlan` in `majorPlans.ts`. Add the verified Computer Science 2026–2027 plan from `BS-CS-roadmap-26.pdf`, including all eight source-published semester groups and each documented alternative exactly as displayed. Set:

```ts
roadmapPdfUrl: 'https://www.fullerton.edu/ecs/cs/_resources/pdfs/BS-CS-roadmap-26.pdf',
programMapperUrl: 'https://csu-fullerton.preview.programmapper.com/academics',
sourcePublishedAt: '2026-06-11',
```

- [ ] **Step 4: Curate every supported major before exposing it**

For each active 2026–2027 CSUF undergraduate major and concentration, add a `MajorPlan` only after recording its official source URL, publication date, eight roadmap semester groups, exact course references, and GE-area requirements. Use a PDF URL when CSUF publishes a verified current PDF. Otherwise set `roadmapPdfUrl: null` and retain the exact Program Mapper fallback URL.

For a source that does not expose a semester-by-semester, course-level plan, do not fabricate an entry. Keep it out of `MAJOR_PLANS`; the app must present only source-backed majors. This keeps the user-visible list honest while the source registry is expanded through reviewed commits.

- [ ] **Step 5: Implement pure query and matching helpers**

In `roadmap.ts`, export:

```ts
export function toRoadmapRequest(requirements: RoadmapRequirement[]): {
  courses: CourseRef[];
  geAreas: string[];
};
export function matchRequirements(
  requirements: RoadmapRequirement[],
  courses: CourseWithSections[],
): Array<{ requirement: RoadmapRequirement; courses: CourseWithSections[] }>;
```

`toRoadmapRequest` must de-duplicate `{subject, catalogNbr}` pairs and GE areas while preserving source order. `matchRequirements` must map a course to each matching explicit option, map GE courses only to GE requirements supplied by API result context, and leave zero-result requirements intact so UI can label them unavailable.

- [ ] **Step 6: Run web unit tests and typecheck**

Run: `npx pnpm --filter @csufsched/web test -- majorPlans.test.ts roadmap.test.ts`

Expected: PASS.

Run: `npx pnpm --filter @csufsched/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit registry and helpers**

```bash
git add apps/web/src/data/majorPlans.ts apps/web/src/data/majorPlans.test.ts apps/web/src/lib/roadmap.ts apps/web/src/lib/roadmap.test.ts
git commit -m "feat: define source-backed major roadmaps"
```

## Task 5: Replace department search with the major planner

**Files:**

- Create: `apps/web/src/components/MajorPlanner.tsx`
- Create: `apps/web/src/components/MajorPlanner.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/store.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/tests/app.test.tsx`
- Delete: `apps/web/src/components/CourseSearch.tsx`
- Delete: `apps/web/tests/coursesearch.test.tsx`

**Interfaces:**

- Consumes: `MAJOR_PLANS`, `toRoadmapRequest`, `matchRequirements`, `api.roadmapCourses`, and store methods below.
- Produces: `MajorPlanner` with selected-major and selected-roadmap-semester UI state.

- [ ] **Step 1: Write failing component tests**

Create `MajorPlanner.test.tsx` with a CS major plan and an API mock returning `CPSC 120A`, `CPSC 120L`, `MATH 150A`, and one approved `GE 3` course. Assert:

```ts
await user.selectOptions(screen.getByLabelText('Major'), 'computer-science-bs');
expect(await screen.findByText('CPSC 120A')).toBeVisible();
expect(screen.getByText('GE Area 3')).toBeVisible();
await user.click(screen.getByRole('tab', { name: 'Year 1 Spring' }));
expect(await screen.findByText('CPSC 121A')).toBeVisible();
```

Add an unavailable-course fixture and assert `Not offered this term` appears with no `+ Solver` button. Assert clicking `+ Solver` adds the returned course to Zustand's wanted list.

- [ ] **Step 2: Run component test and verify red**

Run: `npx pnpm --filter @csufsched/web test -- MajorPlanner.test.tsx`

Expected: FAIL because the component and API client method do not exist.

- [ ] **Step 3: Add typed roadmap API client and persisted state**

Add to `api.ts`:

```ts
roadmapCourses: (termId: number, courses: CourseRef[], geAreas: string[]) =>
  getJson<RoadmapCoursesResponse>(`/api/terms/${termId}/roadmap-courses?${params}`),
```

Build `params` with `URLSearchParams`; omit empty arguments. In `store.ts`, add `majorId: string | null`, `roadmapSemesterId: RoadmapSemester['id']`, `setMajor(id)`, and `setRoadmapSemester(id)`. `setMajor` sets the first semester id but never clears `catalog`, `placedSectionIds`, `wantedCourseIds`, or `busyBlocks`.

- [ ] **Step 4: Implement MajorPlanner**

Use a labelled native select with an initial `Select your major` option. Display a semantic tab list for the eight roadmap semesters. On selection, serialize requirements, call `api.roadmapCourses`, store returned courses in the existing catalog shape, and render source-order requirement rows. A course requirement can expand sections and add any offered result to Solver; an unavailable requirement renders a text-only state. GE rows render the official area label and their valid current-term options. Render loading and stale states without removing previously resolved rows.

- [ ] **Step 5: Replace App data wiring**

Remove `CourseSearch` import and render `MajorPlanner` in its planning-rail position. Keep existing `setTerm` behavior. When no major is selected, show an instructional empty state: `Choose a major to see your recommended pathway.` Update `apps/web/tests/app.test.tsx` mocks from department endpoints to `roadmap-courses` responses.

- [ ] **Step 6: Run web tests and typecheck**

Run: `npx pnpm --filter @csufsched/web test`

Expected: PASS, including replacement of CourseSearch coverage with major planner behavior.

Run: `npx pnpm --filter @csufsched/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit major planner**

```bash
git add apps/web/src/components/MajorPlanner.tsx apps/web/src/components/MajorPlanner.test.tsx apps/web/src/lib/api.ts apps/web/src/store.ts apps/web/src/App.tsx apps/web/tests/app.test.tsx
git rm apps/web/src/components/CourseSearch.tsx apps/web/tests/coursesearch.test.tsx
git commit -m "feat: plan schedules by major roadmap"
```

## Task 6: Add roadmap preview and Titan visual system

**Files:**

- Create: `apps/web/src/components/RoadmapPanel.tsx`
- Create: `apps/web/src/components/RoadmapPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/tests/app.test.tsx`

**Interfaces:**

- Consumes: selected `MajorPlan` and the major planner's source metadata.
- Produces: accessible official-roadmap preview, Program Mapper fallback, responsive Titan workspace.

- [ ] **Step 1: Write failing preview tests**

Create `RoadmapPanel.test.tsx` asserting a PDF-backed plan renders:

```tsx
<iframe title="Computer Science official roadmap" src={plan.roadmapPdfUrl} />
```

and an accessible `Official roadmap` link. Assert `roadmapPdfUrl: null` renders `No verified PDF published for this major.` and a Program Mapper link. In both cases assert the planning notice is visible.

- [ ] **Step 2: Run preview test and verify red**

Run: `npx pnpm --filter @csufsched/web test -- RoadmapPanel.test.tsx`

Expected: FAIL because `RoadmapPanel` does not exist.

- [ ] **Step 3: Implement RoadmapPanel**

Render no panel before major selection. For a selected plan, show its name, catalog year, `Source updated <date>`, source link, planning notice, and a titled iframe only when `roadmapPdfUrl` is non-null. For missing PDFs, show the source-backed fallback state and Program Mapper link; do not render an empty iframe.

- [ ] **Step 4: Create Titan design tokens and responsive shell**

Replace the one-line `index.css` with Tailwind theme variables and focused component classes. Required tokens:

```css
@theme {
  --color-titan-blue: #00244e;
  --color-titan-orange: #ff7900;
  --color-titan-paper: #f8f7f3;
  --color-titan-surface: #f5f5f5;
  --color-titan-ink: #222222;
}
```

Use a two-rail CSS grid at `min-width: 1280px`, stack roadmap under calendar below that breakpoint, and place planning controls above calendar below `768px`. Add visible `:focus-visible` rings, selected tab text/icon state beyond color, and `@media (prefers-reduced-motion: reduce)` rules disabling transitions. Keep orange for compact current-tab, focus, and action accents only.

Update `App.tsx` markup with a semantic header, labelled planning `aside`, calendar `main`, and roadmap `aside`. Do not introduce a modal or decorative logo treatment.

- [ ] **Step 5: Run UI tests, typecheck, and build**

Run: `npx pnpm --filter @csufsched/web test`

Expected: PASS.

Run: `npx pnpm --filter @csufsched/web typecheck && npx pnpm --filter @csufsched/web build`

Expected: PASS.

- [ ] **Step 6: Commit Titan UI**

```bash
git add apps/web/src/components/RoadmapPanel.tsx apps/web/src/components/RoadmapPanel.test.tsx apps/web/src/App.tsx apps/web/src/index.css apps/web/tests/app.test.tsx
git commit -m "feat: add Titan roadmap workspace"
```

## Task 7: End-to-end coverage and release verification

**Files:**

- Modify: `apps/web/e2e/fixtures.ts`
- Modify: `apps/web/e2e/smoke.spec.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: completed API route, major registry, planner UI, and roadmap panel.
- Produces: one browser-proven major-to-schedule path and updated local data-refresh operations.

- [ ] **Step 1: Write the failing browser path**

In `e2e/fixtures.ts`, route `/api/terms/*/roadmap-courses` with a `CPSC 120A`, `CPSC 120L`, `MATH 150A`, and approved GE response. Modify the smoke test to:

```ts
await page.getByLabel('Major').selectOption('computer-science-bs');
await expect(page.getByText('CPSC 120A')).toBeVisible();
await page.getByRole('button', { name: '+ Solver', exact: true }).first().click();
await page.getByRole('button', { name: 'Generate schedules' }).click();
await expect(page.getByTestId('candidate').first()).toBeVisible();
await expect(page.getByTitle('Computer Science official roadmap')).toBeVisible();
```

- [ ] **Step 2: Run browser path and verify red**

Run: `npx pnpm --filter @csufsched/web test:e2e`

Expected: FAIL before the completed major planner and roadmap panel exist.

- [ ] **Step 3: Update operations documentation**

In `README.md`, add GE refresh to the full-scrape description: it imports the official Fall-2025-and-later GE snapshot, retains prior verified tags when the source fails, and exits nonzero so an operator can investigate. Add planning-aid language: roadmap and GE data are not a replacement for TDA or academic advising.

- [ ] **Step 4: Run focused browser test and full repository verification**

Run: `npx pnpm --filter @csufsched/web test:e2e`

Expected: PASS.

Run: `npx pnpm -r typecheck`

Expected: PASS.

Run: `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm -r test`

Expected: PASS with GE integration blocks exercised.

- [ ] **Step 5: Run live source smoke test**

Run: `LIVE_SCRAPE=1 npx pnpm --filter @csufsched/scraper-csuf test -- live`

Expected: PASS. If it fails because CSUF changed source markup, keep prior GE data unchanged, record a fresh fixture from the changed source, update parser tests, then rerun this command.

- [ ] **Step 6: Commit final verification changes**

```bash
git add apps/web/e2e/fixtures.ts apps/web/e2e/smoke.spec.ts README.md
git commit -m "test: cover major roadmap planning"
```

## Plan self-review

- Spec coverage: Tasks 1–2 provide source-backed, failure-safe GE ingestion; Task 3 exposes current-term exact and GE matches; Task 4 provides reviewed major data; Tasks 5–6 implement the major-first Titan workspace and source preview; Task 7 verifies and documents the complete workflow.
- Source safety: no task fabricates a roadmap or turns archived content into a current one. Missing PDFs link to Program Mapper.
- Contract consistency: Task 1 defines `RoadmapCoursesResponse`; Task 3 returns it; Task 5 consumes it; Task 7 stubs that same route.
- Scope boundary: a major only becomes selectable after its exact, current source data has been reviewed and committed. This is deliberate: an incomplete selector is safer than fictional graduation guidance.
