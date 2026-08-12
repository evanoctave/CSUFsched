# CSUF Major Roadmaps and Titan UI Design

## Goal

Turn CSUFsched into a CSUF-branded planning workspace where selecting a degree major, rather than a single catalog department, reveals that major's recommended 2026–2027 pathway, current-term roadmap courses, approved GE choices, and an official roadmap visual beside the weekly schedule.

## Product boundary

CSUFsched is a planning aid. It must label every roadmap and GE result with its source period and direct students to their Titan Degree Audit (TDA) and an academic adviser for an authoritative graduation check. It must never infer missing requirements, convert an old roadmap into a current one, or claim that a generated schedule completes a degree.

## Official sources

- CSUF Academic Program Mapper: `https://csu-fullerton.preview.programmapper.com/academics`
- CSUF approved GE courses, catalog years Fall 2025 and later: `https://www.fullerton.edu/general-education/student-info/approved-courses.html`
- CSUF Computer Science 2026–2027 roadmap: `https://www.fullerton.edu/ecs/cs/_resources/pdfs/BS-CS-roadmap-26.pdf`
- CSUF brand colors: `https://brand.fullerton.edu/colors/`

The university's central Academic Roadmaps page exposes archived files only. Current roadmap documents are therefore tracked program by program. A program without a published, verifiable 2026–2027 PDF must show its official Program Mapper link, not an invented preview.

## User experience

### Workspace

Use a light, desktop-first planning surface:

- A Titan Blue header frames the selected major, class term, and share actions.
- A left planning rail contains major selection, roadmap-semester tabs, current pathway courses, and solver preferences.
- The center holds the existing draggable weekly calendar.
- A right roadmap rail displays the selected program's official roadmap visual and source details.
- At narrow widths, rails stack below the calendar. The roadmap remains reachable without a modal.

Use CSUF web colors: Titan Blue `#00244E` for structure and primary actions, Titan Orange `#FF7900` for small active accents only, Beige `#F8F7F3` as page ground, Light Gray `#F5F5F5` for quiet surfaces, and Text `#222222`. Orange never carries body text because it lacks accessible contrast on light backgrounds.

### Major-driven course selection

The current Department selector is removed. A searchable Major selector chooses a `MajorPlan` and persists the selected major and roadmap semester locally.

Each major has eight roadmap-semester tabs, from Year 1 Fall through Year 4 Spring. The active tab shows only source-backed requirements for that stage:

- Exact requirements such as `CPSC 120A` or `MATH 150A` resolve against current-term sections.
- A requirement with approved alternatives presents every listed alternative.
- GE requirements resolve only to current-term courses tagged with that official GE area.
- A requirement absent from the current class term stays visible as `Not offered this term`; it cannot be added to the solver.

Changing majors preserves an already built schedule and solver list. It changes only pathway guidance and course discovery, avoiding silent removal of a student's work.

### Roadmap visual

The roadmap rail has a clear major name, `Catalog year 2026–2027` label, source date, and `Official roadmap` link. A verified PDF is embedded as a titled, zoomable browser PDF preview. Program Mapper is always linked. For a major without a verified PDF, the rail presents a clear no-preview state with its Program Mapper link and never substitutes another major's image.

All pathway guidance carries this short notice: `Planning guide only. Verify your Titan Degree Audit and adviser.`

## Data model

### Major registry

Create a versioned, code-reviewed registry of every active CSUF undergraduate major and concentration supported by the 2026–2027 catalog. A registry entry is source data, not an algorithmic guess.

```ts
export interface CourseRef {
  subject: string;
  catalogNbr: string;
}

export type RoadmapRequirement =
  | {
      kind: 'course';
      label: string;
      options: CourseRef[];
    }
  | {
      kind: 'ge';
      area: '1A' | '1B' | '1C' | '2A' | '3' | '4' | '5A' | '5B' | '6' | 'Z';
      label: string;
    };

export interface RoadmapSemester {
  id: 'y1-fall' | 'y1-spring' | 'y2-fall' | 'y2-spring' | 'y3-fall' | 'y3-spring' | 'y4-fall' | 'y4-spring';
  label: string;
  requirements: RoadmapRequirement[];
}

export interface MajorPlan {
  id: string;
  name: string;
  catalogYear: '2026-2027';
  roadmapPdfUrl: string | null;
  programMapperUrl: string;
  sourcePublishedAt: string;
  semesters: RoadmapSemester[];
}
```

Every entry records its primary official source URL and publication date. Exact requirements may include an explicit alternative list only when that alternative appears in the official source. GE requirements use the official area identifier, never a hand-picked department list.

### Approved GE data

Add `ge_course_areas` to Postgres:

```sql
catalog_year TEXT NOT NULL,
area TEXT NOT NULL,
subject TEXT NOT NULL,
catalog_nbr TEXT NOT NULL,
source_url TEXT NOT NULL,
source_published_at TIMESTAMPTZ NOT NULL,
PRIMARY KEY (catalog_year, area, subject, catalog_nbr)
```

Extend the CSUF data refresh with an official GE fetch and parser for the Fall 2025-and-later source. It writes a complete parsed snapshot inside one transaction. If source retrieval or parsing fails, it leaves the last verified GE rows in place, returns a nonzero status, and reports the failure. This prevents an empty or partial source from erasing valid GE choices.

## API

Add one read-only route:

`GET /api/terms/:termId/roadmap-courses?courses=CPSC:120A,MATH:150A&geAreas=1A,3`

Rules:

- `courses` and `geAreas` are optional, but at least one nonempty value is required.
- Each `courses` token is an uppercase subject, a colon, and a catalog number. Invalid tokens return the existing structured `400 bad_request` response.
- The result contains current-term `CourseWithSections` records that match an exact course reference or a `ge_course_areas` row for catalog year `2026-2027`.
- Deduplicate courses that match both groups. Preserve the existing course, section, meeting, and professor shapes.
- Return source metadata for GE results so the web app can show freshness and the official source link.

The route reads only. Catalog scraping remains the sole writer for terms, departments, courses, and sections; GE refresh is the sole writer for `ge_course_areas`.

## Web architecture

New focused web units:

- `src/data/majorPlans.ts`: reviewed major registry and type exports.
- `src/lib/roadmap.ts`: requirement-to-query serialization and current-term result matching.
- `src/components/MajorPlanner.tsx`: searchable major selector, roadmap-semester tabs, and source-backed requirement list.
- `src/components/RoadmapPanel.tsx`: roadmap preview, source details, Program Mapper fallback, and planning notice.
- `src/lib/api.ts`: typed roadmap-course request.

`App.tsx` becomes the shell that coordinates term selection, `MajorPlanner`, schedule calendar, and `RoadmapPanel`. `CourseSearch.tsx` is replaced by `MajorPlanner`; it no longer exposes a raw department filter. Solver, drag-and-drop, sharing, and ICS export retain their existing contracts.

## Error states

- Missing major registry entry: selector never presents it as a supported pathway.
- Missing verified PDF: show Program Mapper fallback, no broken frame.
- Roadmap course unavailable this term: show it in its roadmap position with `Not offered this term`.
- GE source stale or unavailable: retain last verified API results, label their source date, and show the official GE source link.
- API failure: preserve the app's existing cached-catalog behavior and visible stale-data banner.

## Accessibility and responsive behavior

- Major selector, semester tabs, requirement actions, and PDF source links work by keyboard.
- Tabs use semantic tab roles, labels include year and term, and selected state is exposed without color alone.
- `iframe` preview has a descriptive title; source link is always available for PDF-reader users.
- Focus uses a visible Titan Blue ring with sufficient contrast.
- Transitions use opacity and color only, respect `prefers-reduced-motion`, and complete within 200ms.
- Desktop uses two rails around the calendar; tablet stacks roadmap below the calendar; mobile shows major controls before the calendar and roadmap after it.

## Test strategy

- Unit-test major registry shape: eight ordered semesters, valid course references, source URLs, and no duplicate major ids.
- Unit-test roadmap query serialization, invalid token rejection, deduplication, GE matching, and unavailable-course labeling.
- Integration-test GE migration and transactional refresh behavior, including a parser failure that preserves prior rows.
- API-test valid mixed exact-and-GE query, invalid query, unknown term, and source metadata.
- Component-test major selection, semester switching, exact course display, GE options, unavailable states, PDF fallback, and persisted major state.
- Extend Playwright smoke test: select Computer Science, switch roadmap term, add a roadmap course, generate a conflict-free candidate, and open the official roadmap source.

## Non-goals

- Replacing TDA or adviser review.
- Claiming graduation eligibility, prerequisite clearance, financial-aid eligibility, or degree completion.
- Guessing roadmaps from department names or class-history data.
- Silently using an archived roadmap for a 2026–2027 major.
