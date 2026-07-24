# Plan 1: Monorepo Scaffold + Shared Types + Solver Package

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm monorepo with shared TypeScript types and a fully tested, pure-TS schedule constraint solver.

**Architecture:** pnpm workspaces monorepo. `packages/types` holds shared domain types (no runtime code). `packages/solver` is a pure-TS package with zero runtime dependencies that filters sections against constraints, enumerates conflict-free schedules via backtracking, scores them, and returns the top 5 with explanations. It runs in the browser later but is developed and tested standalone with Vitest.

**Tech Stack:** pnpm workspaces, TypeScript 5 (strict), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-csuf-schedule-builder-design.md`

**Follow-up plans:** Plan 2 (DB + scrapers), Plan 3 (API), Plan 4 (frontend).

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Modify: `.gitignore` (append)

- [ ] **Step 1: Verify pnpm is available**

Run: `pnpm --version`
Expected: a version number (9.x or newer). If missing, run `corepack enable && corepack prepare pnpm@latest --activate`.

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "csufsched",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "scrapers/*"
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

- [ ] **Step 5: Append to `.gitignore`**

Append these lines to the existing `.gitignore`:

```
node_modules/
dist/
.env
```

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Expected: completes without error, creates `pnpm-lock.yaml`.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo"
```

---

### Task 2: Shared types package

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`

- [ ] **Step 1: Create `packages/types/package.json`**

```json
{
  "name": "@csufsched/types",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "echo \"no tests\" && exit 0"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

Note: `main` points at TypeScript source. Consumers (Vitest, Vite) handle TS directly — no build step needed.

- [ ] **Step 2: Create `packages/types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/types/src/index.ts`**

```ts
export type Day = 'M' | 'Tu' | 'W' | 'Th' | 'F' | 'Sa';

export interface Meeting {
  days: Day[];
  startMin: number; // minutes from midnight, e.g. 600 = 10:00am
  endMin: number;
  building?: string;
  room?: string;
}

export interface ProfessorSummary {
  id: number;
  fullName: string;
  rating: number | null; // 1–5, null = no RMP match
  difficulty: number | null;
  wouldTakeAgainPct: number | null;
  topTags: string[];
}

export interface Section {
  id: number;
  courseId: number;
  classNbr: string; // 5-digit CSUF class number
  sectionCode: string; // "01"
  mode: 'in-person' | 'online' | 'hybrid';
  enrollmentStatus: 'open' | 'closed' | 'waitlist';
  professor: ProfessorSummary | null;
  meetings: Meeting[]; // empty for async-online sections
}

export interface Course {
  id: number;
  deptCode: string; // "CPSC"
  catalogNbr: string; // "121"
  title: string;
  units: number;
}

export interface CourseWithSections extends Course {
  sections: Section[];
}

export interface TimeBlock {
  day: Day;
  startMin: number;
  endMin: number;
}

export interface SolverPrefs {
  avoidDays: Day[];
  earliestStart?: number; // minutes from midnight
  latestEnd?: number;
  maxUnits: number; // default 18; UI warns above but solver still runs
  weightProfRating: number; // 0–1
  weightMinimizeGaps: number; // 0–1
}

export interface SolverInput {
  courses: CourseWithSections[];
  busyBlocks: TimeBlock[];
  lockedSectionIds: number[]; // sections already on the grid; forced for their course
  prefs: SolverPrefs;
}

export interface ScheduleCandidate {
  sectionIds: number[];
  score: number;
  explanation: string; // "avg prof ★4.1 · 45 min gaps · 3 days on campus"
}

export type EliminationReason = 'busy-block' | 'avoid-day' | 'time-window' | 'conflict';

export interface CourseElimination {
  courseId: number;
  courseLabel: string; // "MATH 150B"
  reasons: EliminationReason[];
}

export interface SolverResult {
  candidates: ScheduleCandidate[]; // top 5 by score
  eliminations: CourseElimination[]; // non-empty exactly when candidates is empty
  totalValidCombos: number;
  truncated: boolean; // true if enumeration hit the combo cap
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm install && pnpm --filter @csufsched/types typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/types pnpm-lock.yaml
git commit -m "feat: add shared domain types package"
```

---

### Task 3: Solver package scaffold + time overlap utilities

**Files:**
- Create: `packages/solver/package.json`
- Create: `packages/solver/tsconfig.json`
- Create: `packages/solver/src/time.ts`
- Test: `packages/solver/tests/time.test.ts`

- [ ] **Step 1: Create `packages/solver/package.json`**

```json
{
  "name": "@csufsched/solver",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@csufsched/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/solver/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: vitest added, workspace link created for `@csufsched/types`.

- [ ] **Step 4: Write failing tests for time utilities**

Create `packages/solver/tests/time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { overlaps, meetingsConflict, meetingConflictsWithBlock } from '../src/time';
import type { Meeting, TimeBlock } from '@csufsched/types';

describe('overlaps', () => {
  it('detects overlapping intervals', () => {
    expect(overlaps(600, 675, 660, 720)).toBe(true);
  });

  it('returns false for touching intervals (end == start)', () => {
    expect(overlaps(600, 675, 675, 720)).toBe(false);
  });

  it('returns false for disjoint intervals', () => {
    expect(overlaps(600, 675, 720, 780)).toBe(false);
  });

  it('detects containment', () => {
    expect(overlaps(600, 720, 630, 660)).toBe(true);
  });
});

describe('meetingsConflict', () => {
  const mwf10: Meeting = { days: ['M', 'W', 'F'], startMin: 600, endMin: 650 };
  const tuth10: Meeting = { days: ['Tu', 'Th'], startMin: 600, endMin: 675 };
  const mw1015: Meeting = { days: ['M', 'W'], startMin: 615, endMin: 665 };

  it('conflicts when days shared and times overlap', () => {
    expect(meetingsConflict(mwf10, mw1015)).toBe(true);
  });

  it('no conflict when no shared days', () => {
    expect(meetingsConflict(mwf10, tuth10)).toBe(false);
  });

  it('no conflict when shared day but disjoint times', () => {
    const mwf12: Meeting = { days: ['M', 'W', 'F'], startMin: 720, endMin: 770 };
    expect(meetingsConflict(mwf10, mwf12)).toBe(false);
  });
});

describe('meetingConflictsWithBlock', () => {
  const mwf10: Meeting = { days: ['M', 'W', 'F'], startMin: 600, endMin: 650 };

  it('conflicts with busy block on same day and time', () => {
    const block: TimeBlock = { day: 'M', startMin: 630, endMin: 700 };
    expect(meetingConflictsWithBlock(mwf10, block)).toBe(true);
  });

  it('no conflict on different day', () => {
    const block: TimeBlock = { day: 'Tu', startMin: 600, endMin: 700 };
    expect(meetingConflictsWithBlock(mwf10, block)).toBe(false);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm --filter @csufsched/solver test`
Expected: FAIL — cannot resolve `../src/time`.

- [ ] **Step 6: Implement `packages/solver/src/time.ts`**

```ts
import type { Meeting, TimeBlock } from '@csufsched/types';

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function meetingsConflict(a: Meeting, b: Meeting): boolean {
  const sharedDay = a.days.some((d) => b.days.includes(d));
  return sharedDay && overlaps(a.startMin, a.endMin, b.startMin, b.endMin);
}

export function meetingConflictsWithBlock(m: Meeting, block: TimeBlock): boolean {
  return m.days.includes(block.day) && overlaps(m.startMin, m.endMin, block.startMin, block.endMin);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @csufsched/solver test`
Expected: PASS, 9 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/solver pnpm-lock.yaml
git commit -m "feat: add solver package with time overlap utilities"
```

---

### Task 4: Test helpers + section conflict checks

**Files:**
- Create: `packages/solver/tests/helpers.ts`
- Create: `packages/solver/src/conflicts.ts`
- Test: `packages/solver/tests/conflicts.test.ts`

- [ ] **Step 1: Create test factories in `packages/solver/tests/helpers.ts`**

```ts
import type {
  CourseWithSections,
  Meeting,
  ProfessorSummary,
  Section,
} from '@csufsched/types';

let nextId = 1;

export function mkProf(rating: number | null, fullName = 'Test Prof'): ProfessorSummary {
  return {
    id: nextId++,
    fullName,
    rating,
    difficulty: null,
    wouldTakeAgainPct: null,
    topTags: [],
  };
}

export function mkSection(
  meetings: Meeting[],
  opts: { id?: number; courseId?: number; professor?: ProfessorSummary | null } = {},
): Section {
  return {
    id: opts.id ?? nextId++,
    courseId: opts.courseId ?? 0,
    classNbr: '10000',
    sectionCode: '01',
    mode: 'in-person',
    enrollmentStatus: 'open',
    professor: opts.professor ?? null,
    meetings,
  };
}

export function mkCourse(
  label: string, // "CPSC 121"
  units: number,
  sections: Section[],
): CourseWithSections {
  const [deptCode, catalogNbr] = label.split(' ');
  const id = nextId++;
  for (const s of sections) s.courseId = id;
  return { id, deptCode, catalogNbr, title: label, units, sections };
}
```

- [ ] **Step 2: Write failing tests in `packages/solver/tests/conflicts.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { sectionsConflict, sectionConflictsWithBlock } from '../src/conflicts';
import { mkSection } from './helpers';
import type { TimeBlock } from '@csufsched/types';

describe('sectionsConflict', () => {
  it('conflicts when any meetings overlap', () => {
    const lectureWithLab = mkSection([
      { days: ['M', 'W'], startMin: 600, endMin: 650 },
      { days: ['F'], startMin: 720, endMin: 830 }, // lab
    ]);
    const fridayClass = mkSection([{ days: ['F'], startMin: 780, endMin: 855 }]);
    expect(sectionsConflict(lectureWithLab, fridayClass)).toBe(true);
  });

  it('no conflict when all meetings disjoint', () => {
    const a = mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 650 }]);
    const b = mkSection([{ days: ['Tu', 'Th'], startMin: 600, endMin: 675 }]);
    expect(sectionsConflict(a, b)).toBe(false);
  });

  it('async online sections (no meetings) never conflict', () => {
    const online = mkSection([]);
    const a = mkSection([{ days: ['M'], startMin: 600, endMin: 650 }]);
    expect(sectionsConflict(online, a)).toBe(false);
  });
});

describe('sectionConflictsWithBlock', () => {
  it('detects conflict with a busy block', () => {
    const s = mkSection([{ days: ['Tu', 'Th'], startMin: 780, endMin: 855 }]);
    const block: TimeBlock = { day: 'Tu', startMin: 800, endMin: 900 };
    expect(sectionConflictsWithBlock(s, block)).toBe(true);
  });

  it('no conflict when block is on a free day', () => {
    const s = mkSection([{ days: ['Tu', 'Th'], startMin: 780, endMin: 855 }]);
    const block: TimeBlock = { day: 'W', startMin: 0, endMin: 1440 };
    expect(sectionConflictsWithBlock(s, block)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @csufsched/solver test`
Expected: FAIL — cannot resolve `../src/conflicts`.

- [ ] **Step 4: Implement `packages/solver/src/conflicts.ts`**

```ts
import type { Section, TimeBlock } from '@csufsched/types';
import { meetingsConflict, meetingConflictsWithBlock } from './time';

export function sectionsConflict(a: Section, b: Section): boolean {
  return a.meetings.some((ma) => b.meetings.some((mb) => meetingsConflict(ma, mb)));
}

export function sectionConflictsWithBlock(s: Section, block: TimeBlock): boolean {
  return s.meetings.some((m) => meetingConflictsWithBlock(m, block));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @csufsched/solver test`
Expected: PASS (14 tests total).

- [ ] **Step 6: Commit**

```bash
git add packages/solver/tests/helpers.ts packages/solver/src/conflicts.ts packages/solver/tests/conflicts.test.ts
git commit -m "feat: add section conflict detection"
```

---

### Task 5: Section filtering against constraints

**Files:**
- Create: `packages/solver/src/filter.ts`
- Test: `packages/solver/tests/filter.test.ts`

- [ ] **Step 1: Write failing tests in `packages/solver/tests/filter.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { filterSections } from '../src/filter';
import { mkCourse, mkSection } from './helpers';
import type { SolverPrefs } from '@csufsched/types';

const basePrefs: SolverPrefs = {
  avoidDays: [],
  maxUnits: 18,
  weightProfRating: 0.5,
  weightMinimizeGaps: 0.5,
};

describe('filterSections', () => {
  it('keeps all sections when nothing conflicts', () => {
    const course = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 675 }]),
      mkSection([{ days: ['Tu', 'Th'], startMin: 600, endMin: 675 }]),
    ]);
    const { viable, reasons } = filterSections(course, [], basePrefs);
    expect(viable).toHaveLength(2);
    expect(reasons.size).toBe(0);
  });

  it('drops sections hitting busy blocks and records reason', () => {
    const course = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M'], startMin: 600, endMin: 675 }]),
      mkSection([{ days: ['Tu'], startMin: 600, endMin: 675 }]),
    ]);
    const { viable, reasons } = filterSections(
      course,
      [{ day: 'M', startMin: 0, endMin: 1440 }],
      basePrefs,
    );
    expect(viable).toHaveLength(1);
    expect(viable[0].meetings[0].days).toEqual(['Tu']);
    expect(reasons.has('busy-block')).toBe(true);
  });

  it('drops sections on avoided days', () => {
    const course = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M', 'W', 'F'], startMin: 600, endMin: 650 }]),
      mkSection([{ days: ['Tu', 'Th'], startMin: 600, endMin: 675 }]),
    ]);
    const { viable, reasons } = filterSections(course, [], { ...basePrefs, avoidDays: ['F'] });
    expect(viable).toHaveLength(1);
    expect(reasons.has('avoid-day')).toBe(true);
  });

  it('drops sections outside the time window', () => {
    const course = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M'], startMin: 480, endMin: 555 }]), // 8am — too early
      mkSection([{ days: ['M'], startMin: 1140, endMin: 1215 }]), // ends 8:15pm — too late
      mkSection([{ days: ['M'], startMin: 660, endMin: 735 }]), // 11am — fine
    ]);
    const { viable, reasons } = filterSections(course, [], {
      ...basePrefs,
      earliestStart: 600,
      latestEnd: 1080,
    });
    expect(viable).toHaveLength(1);
    expect(viable[0].meetings[0].startMin).toBe(660);
    expect(reasons.has('time-window')).toBe(true);
  });

  it('async online sections survive every filter', () => {
    const course = mkCourse('CPSC 121', 3, [mkSection([])]);
    const { viable } = filterSections(
      course,
      [{ day: 'M', startMin: 0, endMin: 1440 }],
      { ...basePrefs, avoidDays: ['M', 'Tu', 'W', 'Th', 'F', 'Sa'], earliestStart: 600, latestEnd: 700 },
    );
    expect(viable).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @csufsched/solver test`
Expected: FAIL — cannot resolve `../src/filter`.

- [ ] **Step 3: Implement `packages/solver/src/filter.ts`**

```ts
import type {
  CourseWithSections,
  EliminationReason,
  Section,
  SolverPrefs,
  TimeBlock,
} from '@csufsched/types';
import { sectionConflictsWithBlock } from './conflicts';

export interface FilterResult {
  viable: Section[];
  reasons: Set<EliminationReason>;
}

export function filterSections(
  course: CourseWithSections,
  busyBlocks: TimeBlock[],
  prefs: SolverPrefs,
): FilterResult {
  const reasons = new Set<EliminationReason>();
  const viable: Section[] = [];

  for (const s of course.sections) {
    if (busyBlocks.some((b) => sectionConflictsWithBlock(s, b))) {
      reasons.add('busy-block');
      continue;
    }
    if (s.meetings.some((m) => m.days.some((d) => prefs.avoidDays.includes(d)))) {
      reasons.add('avoid-day');
      continue;
    }
    if (
      prefs.earliestStart !== undefined &&
      s.meetings.some((m) => m.startMin < prefs.earliestStart!)
    ) {
      reasons.add('time-window');
      continue;
    }
    if (prefs.latestEnd !== undefined && s.meetings.some((m) => m.endMin > prefs.latestEnd!)) {
      reasons.add('time-window');
      continue;
    }
    viable.push(s);
  }

  return { viable, reasons };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @csufsched/solver test`
Expected: PASS (19 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/solver/src/filter.ts packages/solver/tests/filter.test.ts
git commit -m "feat: add constraint-based section filtering"
```

---

### Task 6: Backtracking enumeration

**Files:**
- Create: `packages/solver/src/enumerate.ts`
- Test: `packages/solver/tests/enumerate.test.ts`

- [ ] **Step 1: Write failing tests in `packages/solver/tests/enumerate.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { enumerateCombos, COMBO_CAP } from '../src/enumerate';
import { mkSection } from './helpers';
import type { Meeting, Section } from '@csufsched/types';

function at(days: Meeting['days'], startMin: number, endMin: number): Section {
  return mkSection([{ days, startMin, endMin }]);
}

describe('enumerateCombos', () => {
  it('returns the cartesian product when nothing conflicts', () => {
    const courseA = [at(['M'], 600, 650), at(['M'], 720, 770)];
    const courseB = [at(['Tu'], 600, 675), at(['Th'], 600, 675)];
    const { combos, truncated } = enumerateCombos([courseA, courseB]);
    expect(combos).toHaveLength(4);
    expect(truncated).toBe(false);
  });

  it('excludes conflicting combinations', () => {
    const clash1 = at(['M'], 600, 650);
    const clash2 = at(['M'], 620, 670);
    const free = at(['Tu'], 600, 675);
    const { combos } = enumerateCombos([[clash1], [clash2, free]]);
    expect(combos).toHaveLength(1);
    expect(combos[0][1].id).toBe(free.id);
  });

  it('returns empty when every combination conflicts', () => {
    const a = at(['M'], 600, 650);
    const b = at(['M'], 600, 650);
    const { combos, deepestIndex } = enumerateCombos([[a], [b]]);
    expect(combos).toHaveLength(0);
    expect(deepestIndex).toBe(1); // reached course index 1, could not extend
  });

  it('truncates at COMBO_CAP', () => {
    // 8 courses x 3 async-online sections = 6561 combos > cap
    const courses = Array.from({ length: 8 }, () => [
      mkSection([]),
      mkSection([]),
      mkSection([]),
    ]);
    const { combos, truncated } = enumerateCombos(courses);
    expect(truncated).toBe(true);
    expect(combos).toHaveLength(COMBO_CAP);
  });

  it('handles a single course', () => {
    const { combos } = enumerateCombos([[at(['M'], 600, 650)]]);
    expect(combos).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @csufsched/solver test`
Expected: FAIL — cannot resolve `../src/enumerate`.

- [ ] **Step 3: Implement `packages/solver/src/enumerate.ts`**

```ts
import type { Section } from '@csufsched/types';
import { sectionsConflict } from './conflicts';

export const COMBO_CAP = 2000;

export interface EnumerateResult {
  combos: Section[][];
  truncated: boolean;
  /** Furthest course index reached with a consistent partial assignment. */
  deepestIndex: number;
}

export function enumerateCombos(sectionsByCourse: Section[][]): EnumerateResult {
  const combos: Section[][] = [];
  let truncated = false;
  let deepest = -1;
  const chosen: Section[] = [];

  function backtrack(i: number): void {
    if (i > deepest) deepest = i;
    if (i === sectionsByCourse.length) {
      combos.push([...chosen]);
      if (combos.length >= COMBO_CAP) truncated = true;
      return;
    }
    for (const s of sectionsByCourse[i]) {
      if (truncated) return;
      if (chosen.some((c) => sectionsConflict(c, s))) continue;
      chosen.push(s);
      backtrack(i + 1);
      chosen.pop();
    }
  }

  backtrack(0);
  return { combos, truncated, deepestIndex: deepest };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @csufsched/solver test`
Expected: PASS (24 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/solver/src/enumerate.ts packages/solver/tests/enumerate.test.ts
git commit -m "feat: add backtracking schedule enumeration with combo cap"
```

---

### Task 7: Scoring

**Files:**
- Create: `packages/solver/src/score.ts`
- Test: `packages/solver/tests/score.test.ts`

Scoring model (from spec): weighted sum of average professor rating (unrated = neutral 3.0), total gap minutes between classes, and days-on-campus count. Normalized:

- `ratingScore = (avgRating - 1) / 4` → 0..1
- `gapScore = max(0, 1 - totalGapMinutes / 480)` → 0..1 (8h of gaps = 0)
- `dayScore = (6 - daysOnCampus) / 6` → 0..1
- `score = 100 * (weightProfRating * ratingScore + weightMinimizeGaps * gapScore + 0.2 * dayScore)`

- [ ] **Step 1: Write failing tests in `packages/solver/tests/score.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { totalGapMinutes, daysOnCampus, avgProfRating, scoreCombo } from '../src/score';
import { mkSection, mkProf } from './helpers';
import type { SolverPrefs } from '@csufsched/types';

const prefs: SolverPrefs = {
  avoidDays: [],
  maxUnits: 18,
  weightProfRating: 1,
  weightMinimizeGaps: 1,
};

describe('totalGapMinutes', () => {
  it('sums gaps between consecutive classes per day', () => {
    const a = mkSection([{ days: ['M'], startMin: 600, endMin: 650 }]); // 10:00–10:50
    const b = mkSection([{ days: ['M'], startMin: 720, endMin: 770 }]); // 12:00–12:50
    expect(totalGapMinutes([a, b])).toBe(70);
  });

  it('returns 0 for back-to-back classes', () => {
    const a = mkSection([{ days: ['M'], startMin: 600, endMin: 650 }]);
    const b = mkSection([{ days: ['M'], startMin: 650, endMin: 700 }]);
    expect(totalGapMinutes([a, b])).toBe(0);
  });

  it('counts gaps independently per day', () => {
    const a = mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 650 }]);
    const b = mkSection([{ days: ['M', 'W'], startMin: 680, endMin: 730 }]);
    expect(totalGapMinutes([a, b])).toBe(60); // 30 on M + 30 on W
  });
});

describe('daysOnCampus', () => {
  it('counts distinct meeting days', () => {
    const a = mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 650 }]);
    const b = mkSection([{ days: ['W', 'F'], startMin: 720, endMin: 770 }]);
    expect(daysOnCampus([a, b])).toBe(3);
  });

  it('returns 0 for all-online schedule', () => {
    expect(daysOnCampus([mkSection([])])).toBe(0);
  });
});

describe('avgProfRating', () => {
  it('averages ratings, treating null as neutral 3.0', () => {
    const rated = mkSection([], { professor: mkProf(5) });
    const unrated = mkSection([], { professor: null });
    expect(avgProfRating([rated, unrated])).toBe(4);
  });
});

describe('scoreCombo', () => {
  it('scores higher-rated, tighter schedules better', () => {
    const good = [
      mkSection([{ days: ['M'], startMin: 600, endMin: 650 }], { professor: mkProf(5) }),
      mkSection([{ days: ['M'], startMin: 650, endMin: 700 }], { professor: mkProf(5) }),
    ];
    const bad = [
      mkSection([{ days: ['M'], startMin: 480, endMin: 530 }], { professor: mkProf(1.5) }),
      mkSection([{ days: ['W'], startMin: 900, endMin: 950 }], { professor: mkProf(1.5) }),
    ];
    expect(scoreCombo(good, prefs)).toBeGreaterThan(scoreCombo(bad, prefs));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @csufsched/solver test`
Expected: FAIL — cannot resolve `../src/score`.

- [ ] **Step 3: Implement `packages/solver/src/score.ts`**

```ts
import type { Day, Section, SolverPrefs } from '@csufsched/types';

export function totalGapMinutes(sections: Section[]): number {
  const byDay = new Map<Day, Array<[number, number]>>();
  for (const s of sections) {
    for (const m of s.meetings) {
      for (const d of m.days) {
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push([m.startMin, m.endMin]);
      }
    }
  }
  let gaps = 0;
  for (const intervals of byDay.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++) {
      gaps += Math.max(0, intervals[i][0] - intervals[i - 1][1]);
    }
  }
  return gaps;
}

export function daysOnCampus(sections: Section[]): number {
  const days = new Set<Day>();
  for (const s of sections) for (const m of s.meetings) for (const d of m.days) days.add(d);
  return days.size;
}

export function avgProfRating(sections: Section[]): number {
  if (sections.length === 0) return 3;
  const ratings = sections.map((s) => s.professor?.rating ?? 3);
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

export function scoreCombo(sections: Section[], prefs: SolverPrefs): number {
  const ratingScore = (avgProfRating(sections) - 1) / 4;
  const gapScore = Math.max(0, 1 - totalGapMinutes(sections) / 480);
  const dayScore = (6 - daysOnCampus(sections)) / 6;
  return (
    100 *
    (prefs.weightProfRating * ratingScore +
      prefs.weightMinimizeGaps * gapScore +
      0.2 * dayScore)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @csufsched/solver test`
Expected: PASS (31 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/solver/src/score.ts packages/solver/tests/score.test.ts
git commit -m "feat: add schedule scoring (prof rating, gaps, campus days)"
```

---

### Task 8: End-to-end solve() + public exports

**Files:**
- Create: `packages/solver/src/solve.ts`
- Create: `packages/solver/src/index.ts`
- Test: `packages/solver/tests/solve.test.ts`

- [ ] **Step 1: Write failing tests in `packages/solver/tests/solve.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { solve } from '../src/solve';
import { mkCourse, mkSection, mkProf } from './helpers';
import type { SolverInput, SolverPrefs } from '@csufsched/types';

const basePrefs: SolverPrefs = {
  avoidDays: [],
  maxUnits: 18,
  weightProfRating: 0.5,
  weightMinimizeGaps: 0.5,
};

function input(partial: Partial<SolverInput>): SolverInput {
  return { courses: [], busyBlocks: [], lockedSectionIds: [], prefs: basePrefs, ...partial };
}

describe('solve', () => {
  it('returns ranked candidates for solvable input', () => {
    const cpsc = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 675 }], { professor: mkProf(4.5) }),
      mkSection([{ days: ['M', 'W'], startMin: 600, endMin: 675 }], { professor: mkProf(2.0) }),
    ]);
    const math = mkCourse('MATH 150B', 4, [
      mkSection([{ days: ['Tu', 'Th'], startMin: 600, endMin: 715 }], { professor: mkProf(3.5) }),
    ]);
    const result = solve(input({ courses: [cpsc, math] }));

    expect(result.candidates).toHaveLength(2);
    expect(result.eliminations).toHaveLength(0);
    expect(result.totalValidCombos).toBe(2);
    // Higher-rated professor combo ranks first
    expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1].score);
    expect(result.candidates[0].explanation).toContain('★');
  });

  it('caps candidates at 5', () => {
    const sections = Array.from({ length: 7 }, () => mkSection([]));
    const course = mkCourse('CPSC 121', 3, sections);
    const result = solve(input({ courses: [course] }));
    expect(result.candidates).toHaveLength(5);
    expect(result.totalValidCombos).toBe(7);
  });

  it('reports which course was eliminated by a busy block', () => {
    const math = mkCourse('MATH 150B', 4, [
      mkSection([{ days: ['Tu'], startMin: 600, endMin: 715 }]),
      mkSection([{ days: ['Tu'], startMin: 720, endMin: 835 }]),
    ]);
    const result = solve(
      input({ courses: [math], busyBlocks: [{ day: 'Tu', startMin: 0, endMin: 1440 }] }),
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.eliminations).toHaveLength(1);
    expect(result.eliminations[0].courseLabel).toBe('MATH 150B');
    expect(result.eliminations[0].reasons).toContain('busy-block');
  });

  it('reports pairwise conflict when courses are individually fine but mutually exclusive', () => {
    const a = mkCourse('CPSC 121', 3, [
      mkSection([{ days: ['M'], startMin: 600, endMin: 675 }]),
    ]);
    const b = mkCourse('CPSC 131', 3, [
      mkSection([{ days: ['M'], startMin: 620, endMin: 695 }]),
    ]);
    const result = solve(input({ courses: [a, b] }));
    expect(result.candidates).toHaveLength(0);
    expect(result.eliminations).toHaveLength(1);
    expect(result.eliminations[0].reasons).toEqual(['conflict']);
  });

  it('locked section is forced for its course', () => {
    const preferred = mkSection([{ days: ['M'], startMin: 600, endMin: 675 }], {
      professor: mkProf(5),
    });
    const locked = mkSection([{ days: ['Tu'], startMin: 600, endMin: 675 }], {
      professor: mkProf(1),
    });
    const course = mkCourse('CPSC 121', 3, [preferred, locked]);
    const result = solve(input({ courses: [course], lockedSectionIds: [locked.id] }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sectionIds).toEqual([locked.id]);
  });

  it('locked section bypasses filters (already accepted by user)', () => {
    const locked = mkSection([{ days: ['F'], startMin: 480, endMin: 555 }]);
    const course = mkCourse('CPSC 121', 3, [locked]);
    const result = solve(
      input({
        courses: [course],
        lockedSectionIds: [locked.id],
        prefs: { ...basePrefs, avoidDays: ['F'], earliestStart: 600 },
      }),
    );
    expect(result.candidates).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @csufsched/solver test`
Expected: FAIL — cannot resolve `../src/solve`.

- [ ] **Step 3: Implement `packages/solver/src/solve.ts`**

```ts
import type {
  CourseElimination,
  EliminationReason,
  ScheduleCandidate,
  Section,
  SolverInput,
  SolverResult,
} from '@csufsched/types';
import { filterSections } from './filter';
import { enumerateCombos } from './enumerate';
import { avgProfRating, daysOnCampus, scoreCombo, totalGapMinutes } from './score';

export const TOP_N = 5;

export function solve(input: SolverInput): SolverResult {
  const { courses, busyBlocks, lockedSectionIds, prefs } = input;
  const locked = new Set(lockedSectionIds);

  const filtered = courses.map((course) => {
    const lockedSection = course.sections.find((s) => locked.has(s.id));
    if (lockedSection) {
      return { course, viable: [lockedSection], reasons: new Set<EliminationReason>() };
    }
    const { viable, reasons } = filterSections(course, busyBlocks, prefs);
    return { course, viable, reasons };
  });

  const eliminations: CourseElimination[] = filtered
    .filter((f) => f.viable.length === 0)
    .map((f) => ({
      courseId: f.course.id,
      courseLabel: `${f.course.deptCode} ${f.course.catalogNbr}`,
      reasons: [...f.reasons],
    }));

  if (eliminations.length > 0) {
    return { candidates: [], eliminations, totalValidCombos: 0, truncated: false };
  }

  // Fewest-sections-first prunes the search tree fastest.
  const ordered = [...filtered].sort((a, b) => a.viable.length - b.viable.length);
  const { combos, truncated, deepestIndex } = enumerateCombos(ordered.map((f) => f.viable));

  if (combos.length === 0) {
    const blocked = ordered[Math.min(deepestIndex, ordered.length - 1)];
    return {
      candidates: [],
      eliminations: [
        {
          courseId: blocked.course.id,
          courseLabel: `${blocked.course.deptCode} ${blocked.course.catalogNbr}`,
          reasons: ['conflict'],
        },
      ],
      totalValidCombos: 0,
      truncated,
    };
  }

  const candidates: ScheduleCandidate[] = combos
    .map((combo) => ({
      sectionIds: combo.map((s) => s.id),
      score: scoreCombo(combo, prefs),
      explanation: explain(combo),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  return { candidates, eliminations: [], totalValidCombos: combos.length, truncated };
}

function explain(combo: Section[]): string {
  const rating = avgProfRating(combo).toFixed(1);
  const gaps = totalGapMinutes(combo);
  const days = daysOnCampus(combo);
  return `avg prof ★${rating} · ${gaps} min gaps · ${days} day${days === 1 ? '' : 's'} on campus`;
}
```

- [ ] **Step 4: Create `packages/solver/src/index.ts`**

```ts
export { solve, TOP_N } from './solve';
export { filterSections } from './filter';
export { enumerateCombos, COMBO_CAP } from './enumerate';
export { scoreCombo, totalGapMinutes, daysOnCampus, avgProfRating } from './score';
export { sectionsConflict, sectionConflictsWithBlock } from './conflicts';
export { overlaps, meetingsConflict, meetingConflictsWithBlock } from './time';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @csufsched/solver test`
Expected: PASS (37 tests total).

- [ ] **Step 6: Typecheck everything**

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 7: Commit**

```bash
git add packages/solver/src/solve.ts packages/solver/src/index.ts packages/solver/tests/solve.test.ts
git commit -m "feat: add end-to-end solve with ranking and elimination diagnostics"
```
