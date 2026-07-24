# CSUF Schedule Builder — Plan 2: Database + Scrapers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PostgreSQL schema + migration runner + upsert layer, CSUF PeopleSoft catalog scraper, and RateMyProfessors scraper with name matcher.

**Architecture:** New workspace package `@csufsched/db` (pg client, SQL migrations, upsert functions, seed script) plus two scraper packages `@csufsched/scraper-csuf` and `@csufsched/scraper-rmp`. Scrapers are split into pure parsers (fixture-tested) and thin fetch/orchestration layers with injectable fetch. DB integration tests are gated on `TEST_DATABASE_URL` so the suite passes without Postgres.

**Tech Stack:** TypeScript strict, pg ^8, Vitest, plain SQL migrations (no ORM). Node 22.6+ (global fetch + `--experimental-strip-types` for CLI scripts; local machine runs v24).

**Environment notes (apply to every task):**
- pnpm is NOT on PATH. Run every pnpm command from the repo root as `npx pnpm ...`.
- Packages are consumed from source: `main` points at `src/index.ts`, no build step (same as Plan 1).
- `@csufsched/types` `Day` union is `'M' | 'Tu' | 'W' | 'Th' | 'F' | 'Sa' | 'Su'`.
- DB integration tests: wrap in `describe.skipIf(!process.env.TEST_DATABASE_URL)`. When the env var is absent they skip and the suite still passes. Tests must create/drop their own schema state.

**Design decisions locked here:**
- `meetings` stores `start_min`/`end_min` INTEGER (minutes from midnight) and `days` TEXT as comma-joined Day codes (`'M,W,F'`) — matches solver types exactly, no time parsing at read time. (Spec's `start_time/end_time` naming refined to minute integers.)
- Upsert conflict keys: `terms.code`, `departments.code`, `courses (term_id, dept_id, catalog_nbr)`, `sections (course_id, class_nbr)`, `professors.full_name`. Meetings and prof_tags are replace-on-write (delete + insert) — simplest idempotency.
- PeopleSoft fixture format: saved JSON array of flat class-row records (one row per meeting pattern), the shape CSUF's class-search endpoint returns. Real endpoint URL comes from env `CSUF_SEARCH_URL`; scraper logic never hardcodes it.
- RMP school ID from env `RMP_SCHOOL_ID` (base64 GraphQL id). GraphQL endpoint `https://www.ratemyprofessors.com/graphql` with basic auth header `Basic dGVzdDp0ZXN0` (public unofficial API convention).

**File structure:**

```
db/                                  @csufsched/db workspace package
  package.json, tsconfig.json
  migrations/001_init.sql
  src/index.ts                       re-exports
  src/pool.ts                        createPool(databaseUrl)
  src/migrate.ts                     orderMigrations, runMigrations + CLI entry
  src/upserts.ts                     upsertTerm/Department/Course/Section, replaceMeetings, upsertProfessor, replaceProfTags
  src/seed.ts                        sample data seeder CLI
  tests/migrate.test.ts, tests/upserts.test.ts
scrapers/csuf/                       @csufsched/scraper-csuf
  package.json, tsconfig.json
  src/index.ts
  src/parse.ts                       parseDays, parseTime, parseClassRows
  src/types.ts                       RawClassRow, ScrapedCourse/Section/Meeting
  src/rateLimit.ts                   rateLimited(fn, minIntervalMs), fetchWithBackoff
  src/run.ts                         scrapeTerm orchestrator + summary report
  tests/parse.test.ts, tests/rateLimit.test.ts, tests/run.test.ts
  tests/fixtures/cpsc.json
scrapers/rmp/                        @csufsched/scraper-rmp
  package.json, tsconfig.json
  src/index.ts
  src/parse.ts                       mapTeacherNode
  src/types.ts                       RmpTeacher
  src/match.ts                       parseCsufName, matchProfessor
  src/run.ts                         fetch teachers, match, update DB, ambiguity report
  tests/parse.test.ts, tests/match.test.ts, tests/run.test.ts
  tests/fixtures/teachers.json
```

---

### Task 1: db package scaffold + migration runner

**Files:**
- Modify: `pnpm-workspace.yaml` (add `db` to packages)
- Create: `db/package.json`
- Create: `db/tsconfig.json`
- Create: `db/src/pool.ts`
- Create: `db/src/migrate.ts`
- Create: `db/src/index.ts`
- Test: `db/tests/migrate.test.ts`

- [ ] **Step 1: Add `db` to the workspace**

Edit `pnpm-workspace.yaml` so the packages list is:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "scrapers/*"
  - "db"
```

(Keep the existing `allowBuilds` / other keys unchanged.)

- [ ] **Step 2: Create `db/package.json`**

```json
{
  "name": "@csufsched/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "migrate": "node --experimental-strip-types src/migrate.ts",
    "seed": "node --experimental-strip-types src/seed.ts"
  },
  "dependencies": {
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create `db/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Install workspace deps**

Run from repo root: `npx pnpm install`
Expected: lockfile updates, pg + @types/pg added, exit 0.

- [ ] **Step 5: Write failing tests in `db/tests/migrate.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { orderMigrations } from '../src/migrate';

describe('orderMigrations', () => {
  it('sorts numeric-prefixed sql files ascending', () => {
    expect(orderMigrations(['002_b.sql', '001_a.sql', '010_c.sql'])).toEqual([
      '001_a.sql',
      '002_b.sql',
      '010_c.sql',
    ]);
  });

  it('ignores non-migration files', () => {
    expect(orderMigrations(['001_a.sql', 'README.md', 'notes.txt', '.DS_Store'])).toEqual([
      '001_a.sql',
    ]);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx pnpm --filter @csufsched/db test`
Expected: FAIL — cannot resolve `../src/migrate`.

- [ ] **Step 7: Create `db/src/pool.ts`**

```ts
import pg from 'pg';

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}
```

- [ ] **Step 8: Create `db/src/migrate.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool } from './pool';

export function orderMigrations(files: string[]): string[] {
  return files.filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
}

export async function runMigrations(pool: pg.Pool, dir: string): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const files = orderMigrations(await readdir(dir));
  const appliedRows = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set<string>(appliedRows.rows.map((r) => r.filename as string));
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return ran;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const pool = createPool(url);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  runMigrations(pool, dir)
    .then((ran) => {
      console.log(ran.length === 0 ? 'No pending migrations' : `Applied: ${ran.join(', ')}`);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 9: Create `db/src/index.ts`**

```ts
export { createPool } from './pool';
export { orderMigrations, runMigrations } from './migrate';
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx pnpm --filter @csufsched/db test`
Expected: PASS (2 tests).

- [ ] **Step 11: Typecheck**

Run: `npx pnpm --filter @csufsched/db typecheck`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml db/package.json db/tsconfig.json db/src/pool.ts db/src/migrate.ts db/src/index.ts db/tests/migrate.test.ts
git commit -m "feat: add db package with SQL migration runner"
```

---

### Task 2: Schema migration + gated integration test

**Files:**
- Create: `db/migrations/001_init.sql`
- Test: append to `db/tests/migrate.test.ts`

- [ ] **Step 1: Write the gated failing integration test (append to `db/tests/migrate.test.ts`)**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../src/pool';
import { runMigrations } from '../src/migrate';

const TEST_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_URL)('runMigrations (integration)', () => {
  it('applies 001_init.sql once and is idempotent', async () => {
    const pool = createPool(TEST_URL!);
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
    try {
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const first = await runMigrations(pool, dir);
      expect(first).toContain('001_init.sql');
      const second = await runMigrations(pool, dir);
      expect(second).toEqual([]);
      const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const names = tables.rows.map((r) => r.table_name);
      for (const t of [
        'terms',
        'departments',
        'courses',
        'sections',
        'meetings',
        'professors',
        'prof_tags',
      ]) {
        expect(names).toContain(t);
      }
    } finally {
      await pool.end();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx pnpm --filter @csufsched/db test`
Expected: 2 pass; integration test SKIPS if `TEST_DATABASE_URL` unset. If Postgres is available (`createdb csufsched_test` then `TEST_DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/db test`), it FAILS — `001_init.sql` missing.

- [ ] **Step 3: Create `db/migrations/001_init.sql`**

```sql
CREATE TABLE terms (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE professors (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  rmp_id TEXT UNIQUE,
  rating REAL,
  difficulty REAL,
  would_take_again_pct REAL,
  num_ratings INTEGER,
  rmp_url TEXT,
  last_scraped_at TIMESTAMPTZ
);

CREATE TABLE prof_tags (
  professor_id INTEGER NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (professor_id, tag)
);

CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  term_id INTEGER NOT NULL REFERENCES terms(id),
  dept_id INTEGER NOT NULL REFERENCES departments(id),
  catalog_nbr TEXT NOT NULL,
  title TEXT NOT NULL,
  units REAL NOT NULL,
  description TEXT,
  UNIQUE (term_id, dept_id, catalog_nbr)
);

CREATE TABLE sections (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  class_nbr TEXT NOT NULL,
  section_code TEXT NOT NULL,
  instructor_id INTEGER REFERENCES professors(id),
  mode TEXT NOT NULL DEFAULT 'in-person',
  enrollment_status TEXT NOT NULL DEFAULT 'open',
  UNIQUE (course_id, class_nbr)
);

CREATE TABLE meetings (
  id SERIAL PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  days TEXT NOT NULL, -- comma-joined Day codes, e.g. 'M,W,F'
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  building TEXT,
  room TEXT
);

CREATE INDEX idx_courses_term_dept ON courses (term_id, dept_id);
CREATE INDEX idx_sections_course ON sections (course_id);
CREATE INDEX idx_meetings_section ON meetings (section_id);
```

- [ ] **Step 4: Run tests again**

Run: `npx pnpm --filter @csufsched/db test` (and with `TEST_DATABASE_URL` if Postgres available)
Expected: PASS (integration passes or skips cleanly).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/001_init.sql db/tests/migrate.test.ts
git commit -m "feat: add initial PostgreSQL schema migration"
```

---

### Task 3: Upsert layer

**Files:**
- Create: `db/src/upserts.ts`
- Modify: `db/src/index.ts`
- Test: `db/tests/upserts.test.ts`

All functions take a `pg.Pool` and return the row id. Meetings and prof_tags use replace-on-write.

- [ ] **Step 1: Write gated failing tests in `db/tests/upserts.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool } from '../src/pool';
import { runMigrations } from '../src/migrate';
import {
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  replaceMeetings,
  upsertProfessor,
  replaceProfTags,
} from '../src/upserts';

const TEST_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_URL)('upserts (integration)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = createPool(TEST_URL!);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
    await runMigrations(pool, dir);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('upsertTerm is idempotent on code', async () => {
    const a = await upsertTerm(pool, { code: '2268', name: 'Fall 2026' });
    const b = await upsertTerm(pool, { code: '2268', name: 'Fall 2026 (rev)' });
    expect(a).toBe(b);
    const row = await pool.query('SELECT name FROM terms WHERE id = $1', [a]);
    expect(row.rows[0].name).toBe('Fall 2026 (rev)');
  });

  it('course/section/meeting chain upserts and replaces meetings', async () => {
    const termId = await upsertTerm(pool, { code: '2268', name: 'Fall 2026' });
    const deptId = await upsertDepartment(pool, { code: 'CPSC', name: 'Computer Science' });
    const courseId = await upsertCourse(pool, {
      termId,
      deptId,
      catalogNbr: '121',
      title: 'Object-Oriented Programming',
      units: 3,
      description: null,
    });
    const sectionId = await upsertSection(pool, {
      courseId,
      classNbr: '12345',
      sectionCode: '01',
      instructorId: null,
      mode: 'in-person',
      enrollmentStatus: 'open',
    });
    await replaceMeetings(pool, sectionId, [
      { days: ['M', 'W'], startMin: 600, endMin: 675, building: 'CS', room: '101' },
    ]);
    await replaceMeetings(pool, sectionId, [
      { days: ['Tu', 'Th'], startMin: 720, endMin: 795, building: null, room: null },
    ]);
    const meetings = await pool.query('SELECT days, start_min FROM meetings WHERE section_id = $1', [
      sectionId,
    ]);
    expect(meetings.rows).toHaveLength(1);
    expect(meetings.rows[0].days).toBe('Tu,Th');
    expect(meetings.rows[0].start_min).toBe(720);
  });

  it('professor upsert + tag replace', async () => {
    const profId = await upsertProfessor(pool, {
      fullName: 'Lee,J',
      rmpId: 'ABC123',
      rating: 4.2,
      difficulty: 2.1,
      wouldTakeAgainPct: 78,
      numRatings: 55,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/1',
    });
    await replaceProfTags(pool, profId, [{ tag: 'clear lectures', count: 12 }]);
    await replaceProfTags(pool, profId, [
      { tag: 'low homework', count: 9 },
      { tag: 'many tests', count: 4 },
    ]);
    const tags = await pool.query(
      'SELECT tag, count FROM prof_tags WHERE professor_id = $1 ORDER BY tag',
      [profId],
    );
    expect(tags.rows).toEqual([
      { tag: 'low homework', count: 9 },
      { tag: 'many tests', count: 4 },
    ]);
  });

  it('upsertProfessor with only a name leaves rating fields null', async () => {
    const id = await upsertProfessor(pool, { fullName: 'Ito,K' });
    const row = await pool.query('SELECT rating, rmp_id FROM professors WHERE id = $1', [id]);
    expect(row.rows[0].rating).toBeNull();
    expect(row.rows[0].rmp_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (or skip)**

Run: `npx pnpm --filter @csufsched/db test`
Expected: without `TEST_DATABASE_URL` everything skips/passes; with it, FAIL — cannot resolve `../src/upserts`.

- [ ] **Step 3: Create `db/src/upserts.ts`**

```ts
import type pg from 'pg';
import type { Day } from '@csufsched/types';

export interface TermRow {
  code: string;
  name: string;
}

export interface DepartmentRow {
  code: string;
  name: string;
}

export interface CourseRow {
  termId: number;
  deptId: number;
  catalogNbr: string;
  title: string;
  units: number;
  description: string | null;
}

export interface SectionRow {
  courseId: number;
  classNbr: string;
  sectionCode: string;
  instructorId: number | null;
  mode: string;
  enrollmentStatus: string;
}

export interface MeetingRow {
  days: Day[];
  startMin: number;
  endMin: number;
  building: string | null;
  room: string | null;
}

export interface ProfessorRow {
  fullName: string;
  rmpId?: string | null;
  rating?: number | null;
  difficulty?: number | null;
  wouldTakeAgainPct?: number | null;
  numRatings?: number | null;
  rmpUrl?: string | null;
}

export async function upsertTerm(pool: pg.Pool, t: TermRow): Promise<number> {
  const res = await pool.query(
    `INSERT INTO terms (code, name) VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [t.code, t.name],
  );
  return res.rows[0].id;
}

export async function upsertDepartment(pool: pg.Pool, d: DepartmentRow): Promise<number> {
  const res = await pool.query(
    `INSERT INTO departments (code, name) VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [d.code, d.name],
  );
  return res.rows[0].id;
}

export async function upsertCourse(pool: pg.Pool, c: CourseRow): Promise<number> {
  const res = await pool.query(
    `INSERT INTO courses (term_id, dept_id, catalog_nbr, title, units, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (term_id, dept_id, catalog_nbr)
     DO UPDATE SET title = EXCLUDED.title, units = EXCLUDED.units, description = EXCLUDED.description
     RETURNING id`,
    [c.termId, c.deptId, c.catalogNbr, c.title, c.units, c.description],
  );
  return res.rows[0].id;
}

export async function upsertSection(pool: pg.Pool, s: SectionRow): Promise<number> {
  const res = await pool.query(
    `INSERT INTO sections (course_id, class_nbr, section_code, instructor_id, mode, enrollment_status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (course_id, class_nbr)
     DO UPDATE SET section_code = EXCLUDED.section_code,
                   instructor_id = EXCLUDED.instructor_id,
                   mode = EXCLUDED.mode,
                   enrollment_status = EXCLUDED.enrollment_status
     RETURNING id`,
    [s.courseId, s.classNbr, s.sectionCode, s.instructorId, s.mode, s.enrollmentStatus],
  );
  return res.rows[0].id;
}

export async function replaceMeetings(
  pool: pg.Pool,
  sectionId: number,
  meetings: MeetingRow[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM meetings WHERE section_id = $1', [sectionId]);
    for (const m of meetings) {
      await client.query(
        `INSERT INTO meetings (section_id, days, start_min, end_min, building, room)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sectionId, m.days.join(','), m.startMin, m.endMin, m.building, m.room],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertProfessor(pool: pg.Pool, p: ProfessorRow): Promise<number> {
  const res = await pool.query(
    `INSERT INTO professors (full_name, rmp_id, rating, difficulty, would_take_again_pct, num_ratings, rmp_url, last_scraped_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $2::text IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (full_name)
     DO UPDATE SET rmp_id = COALESCE(EXCLUDED.rmp_id, professors.rmp_id),
                   rating = COALESCE(EXCLUDED.rating, professors.rating),
                   difficulty = COALESCE(EXCLUDED.difficulty, professors.difficulty),
                   would_take_again_pct = COALESCE(EXCLUDED.would_take_again_pct, professors.would_take_again_pct),
                   num_ratings = COALESCE(EXCLUDED.num_ratings, professors.num_ratings),
                   rmp_url = COALESCE(EXCLUDED.rmp_url, professors.rmp_url),
                   last_scraped_at = COALESCE(EXCLUDED.last_scraped_at, professors.last_scraped_at)
     RETURNING id`,
    [
      p.fullName,
      p.rmpId ?? null,
      p.rating ?? null,
      p.difficulty ?? null,
      p.wouldTakeAgainPct ?? null,
      p.numRatings ?? null,
      p.rmpUrl ?? null,
    ],
  );
  return res.rows[0].id;
}

export async function replaceProfTags(
  pool: pg.Pool,
  professorId: number,
  tags: Array<{ tag: string; count: number }>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM prof_tags WHERE professor_id = $1', [professorId]);
    for (const t of tags) {
      await client.query('INSERT INTO prof_tags (professor_id, tag, count) VALUES ($1, $2, $3)', [
        professorId,
        t.tag,
        t.count,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Add `@csufsched/types` dependency to `db/package.json`**

In `db/package.json` `dependencies`, add `"@csufsched/types": "workspace:*"`, then run `npx pnpm install`.

- [ ] **Step 5: Update `db/src/index.ts`**

```ts
export { createPool } from './pool';
export { orderMigrations, runMigrations } from './migrate';
export {
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  replaceMeetings,
  upsertProfessor,
  replaceProfTags,
} from './upserts';
export type {
  TermRow,
  DepartmentRow,
  CourseRow,
  SectionRow,
  MeetingRow,
  ProfessorRow,
} from './upserts';
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx pnpm --filter @csufsched/db test` (with `TEST_DATABASE_URL` if available) and `npx pnpm --filter @csufsched/db typecheck`
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add db/src/upserts.ts db/src/index.ts db/tests/upserts.test.ts db/package.json pnpm-lock.yaml
git commit -m "feat: add idempotent upsert layer for catalog and professor data"
```

---

### Task 4: Seed script

**Files:**
- Create: `db/src/seed.ts`

Dev convenience: populate a small sample catalog without scraping. No test (thin composition of already-tested upserts); verified by running it if Postgres is available.

- [ ] **Step 1: Create `db/src/seed.ts`**

```ts
import { createPool } from './pool';
import {
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  replaceMeetings,
  upsertProfessor,
  replaceProfTags,
} from './upserts';

async function seed(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    const termId = await upsertTerm(pool, { code: '2268', name: 'Fall 2026' });
    const cpscId = await upsertDepartment(pool, { code: 'CPSC', name: 'Computer Science' });
    const mathId = await upsertDepartment(pool, { code: 'MATH', name: 'Mathematics' });

    const lee = await upsertProfessor(pool, {
      fullName: 'Lee,J',
      rmpId: 'VGVhY2hlci0x',
      rating: 4.2,
      difficulty: 2.1,
      wouldTakeAgainPct: 78,
      numRatings: 55,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/1',
    });
    await replaceProfTags(pool, lee, [
      { tag: 'clear lectures', count: 12 },
      { tag: 'low homework', count: 9 },
    ]);
    const ito = await upsertProfessor(pool, { fullName: 'Ito,K' });

    const cpsc121 = await upsertCourse(pool, {
      termId,
      deptId: cpscId,
      catalogNbr: '121',
      title: 'Object-Oriented Programming',
      units: 3,
      description: 'Programming in an object-oriented language.',
    });
    const s1 = await upsertSection(pool, {
      courseId: cpsc121,
      classNbr: '12345',
      sectionCode: '01',
      instructorId: lee,
      mode: 'in-person',
      enrollmentStatus: 'open',
    });
    await replaceMeetings(pool, s1, [
      { days: ['M', 'W', 'F'], startMin: 600, endMin: 650, building: 'CS', room: '101' },
    ]);
    const s2 = await upsertSection(pool, {
      courseId: cpsc121,
      classNbr: '12346',
      sectionCode: '02',
      instructorId: ito,
      mode: 'in-person',
      enrollmentStatus: 'waitlist',
    });
    await replaceMeetings(pool, s2, [
      { days: ['Tu', 'Th'], startMin: 780, endMin: 855, building: 'CS', room: '102' },
    ]);

    const math150b = await upsertCourse(pool, {
      termId,
      deptId: mathId,
      catalogNbr: '150B',
      title: 'Calculus II',
      units: 4,
      description: null,
    });
    const s3 = await upsertSection(pool, {
      courseId: math150b,
      classNbr: '20001',
      sectionCode: '01',
      instructorId: null,
      mode: 'in-person',
      enrollmentStatus: 'open',
    });
    await replaceMeetings(pool, s3, [
      { days: ['M', 'W'], startMin: 720, endMin: 835, building: 'MH', room: '390' },
    ]);

    console.log('Seed complete');
  } finally {
    await pool.end();
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
seed(url).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `npx pnpm --filter @csufsched/db typecheck`
Expected: no errors. (If Postgres available: `DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/db migrate && DATABASE_URL=postgres://localhost/csufsched_test npx pnpm --filter @csufsched/db seed` → "Seed complete".)

- [ ] **Step 3: Commit**

```bash
git add db/src/seed.ts
git commit -m "feat: add dev seed script with sample catalog data"
```

---

### Task 5: CSUF scraper scaffold + day/time parsing

**Files:**
- Create: `scrapers/csuf/package.json`
- Create: `scrapers/csuf/tsconfig.json`
- Create: `scrapers/csuf/src/types.ts`
- Create: `scrapers/csuf/src/parse.ts` (parseDays + parseTime only in this task)
- Create: `scrapers/csuf/src/index.ts`
- Test: `scrapers/csuf/tests/parse.test.ts`

- [ ] **Step 1: Create `scrapers/csuf/package.json`**

```json
{
  "name": "@csufsched/scraper-csuf",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "scrape": "node --experimental-strip-types src/run.ts"
  },
  "dependencies": {
    "@csufsched/db": "workspace:*",
    "@csufsched/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `scrapers/csuf/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Run `npx pnpm install`** (link workspace deps)

- [ ] **Step 4: Create `scrapers/csuf/src/types.ts`**

```ts
import type { Day } from '@csufsched/types';

// One flat row per meeting pattern, as returned by the PeopleSoft class-search endpoint.
export interface RawClassRow {
  subject: string; // "CPSC"
  catalog_nbr: string; // "121"
  descr: string; // course title
  units: string; // "3" or "1 - 3"
  class_nbr: string; // "12345"
  class_section: string; // "01"
  instructor: string; // "Lee,J" or "" or "Staff"
  meeting_days: string; // "MoWeFr", "TuTh", "" for async
  start_time: string; // "10:00AM", "" for async
  end_time: string; // "10:50AM"
  building: string; // "CS" or ""
  room: string; // "101" or ""
  instruction_mode: string; // "P" in-person, "OL" online, "HY" hybrid
  enrollment_status: string; // "O" open, "C" closed, "W" waitlist
}

export interface ScrapedMeeting {
  days: Day[];
  startMin: number;
  endMin: number;
  building: string | null;
  room: string | null;
}

export interface ScrapedSection {
  classNbr: string;
  sectionCode: string;
  instructorName: string | null;
  mode: 'in-person' | 'online' | 'hybrid';
  enrollmentStatus: 'open' | 'closed' | 'waitlist';
  meetings: ScrapedMeeting[];
}

export interface ScrapedCourse {
  deptCode: string;
  catalogNbr: string;
  title: string;
  units: number;
  sections: ScrapedSection[];
}
```

- [ ] **Step 5: Write failing tests in `scrapers/csuf/tests/parse.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseDays, parseTime } from '../src/parse';

describe('parseDays', () => {
  it('maps PeopleSoft day pairs to Day codes', () => {
    expect(parseDays('MoWeFr')).toEqual(['M', 'W', 'F']);
    expect(parseDays('TuTh')).toEqual(['Tu', 'Th']);
    expect(parseDays('SaSu')).toEqual(['Sa', 'Su']);
  });

  it('returns empty array for blank or TBA', () => {
    expect(parseDays('')).toEqual([]);
    expect(parseDays('TBA')).toEqual([]);
  });

  it('throws on unrecognized tokens', () => {
    expect(() => parseDays('MoXx')).toThrow(/unrecognized/i);
  });
});

describe('parseTime', () => {
  it('parses AM/PM times to minutes from midnight', () => {
    expect(parseTime('10:00AM')).toBe(600);
    expect(parseTime('1:15PM')).toBe(795);
    expect(parseTime('12:00PM')).toBe(720);
    expect(parseTime('12:30AM')).toBe(30);
  });

  it('returns null for blank or TBA', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('TBA')).toBeNull();
  });

  it('throws on malformed input', () => {
    expect(() => parseTime('25:00AM')).toThrow(/invalid/i);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test`
Expected: FAIL — cannot resolve `../src/parse`.

- [ ] **Step 7: Create `scrapers/csuf/src/parse.ts`**

```ts
import type { Day } from '@csufsched/types';

const DAY_MAP: Record<string, Day> = {
  Mo: 'M',
  Tu: 'Tu',
  We: 'W',
  Th: 'Th',
  Fr: 'F',
  Sa: 'Sa',
  Su: 'Su',
};

export function parseDays(raw: string): Day[] {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'TBA') return [];
  const days: Day[] = [];
  for (let i = 0; i < trimmed.length; i += 2) {
    const token = trimmed.slice(i, i + 2);
    const day = DAY_MAP[token];
    if (!day) throw new Error(`unrecognized day token "${token}" in "${raw}"`);
    days.push(day);
  }
  return days;
}

export function parseTime(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'TBA') return null;
  const m = /^(\d{1,2}):(\d{2})(AM|PM)$/.exec(trimmed);
  if (!m) throw new Error(`invalid time "${raw}"`);
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 1 || hours > 12 || minutes > 59) throw new Error(`invalid time "${raw}"`);
  if (m[3] === 'AM' && hours === 12) hours = 0;
  if (m[3] === 'PM' && hours !== 12) hours += 12;
  return hours * 60 + minutes;
}
```

- [ ] **Step 8: Create `scrapers/csuf/src/index.ts`**

```ts
export { parseDays, parseTime } from './parse';
export type {
  RawClassRow,
  ScrapedMeeting,
  ScrapedSection,
  ScrapedCourse,
} from './types';
```

- [ ] **Step 9: Run tests + typecheck**

Run: `npx pnpm --filter @csufsched/scraper-csuf test` then `npx pnpm --filter @csufsched/scraper-csuf typecheck`
Expected: PASS (6 tests) / no errors.

- [ ] **Step 10: Commit**

```bash
git add scrapers/csuf pnpm-lock.yaml
git commit -m "feat: scaffold CSUF scraper with day/time parsing"
```

---

### Task 6: CSUF row parser (fixture → ScrapedCourse[])

**Files:**
- Create: `scrapers/csuf/tests/fixtures/cpsc.json`
- Modify: `scrapers/csuf/src/parse.ts` (add parseClassRows)
- Modify: `scrapers/csuf/src/index.ts`
- Test: append to `scrapers/csuf/tests/parse.test.ts`

- [ ] **Step 1: Create fixture `scrapers/csuf/tests/fixtures/cpsc.json`**

```json
[
  {
    "subject": "CPSC",
    "catalog_nbr": "121",
    "descr": "Object-Oriented Programming",
    "units": "3",
    "class_nbr": "12345",
    "class_section": "01",
    "instructor": "Lee,J",
    "meeting_days": "MoWeFr",
    "start_time": "10:00AM",
    "end_time": "10:50AM",
    "building": "CS",
    "room": "101",
    "instruction_mode": "P",
    "enrollment_status": "O"
  },
  {
    "subject": "CPSC",
    "catalog_nbr": "121",
    "descr": "Object-Oriented Programming",
    "units": "3",
    "class_nbr": "12345",
    "class_section": "01",
    "instructor": "Lee,J",
    "meeting_days": "Fr",
    "start_time": "11:00AM",
    "end_time": "11:50AM",
    "building": "CS",
    "room": "L20",
    "instruction_mode": "P",
    "enrollment_status": "O"
  },
  {
    "subject": "CPSC",
    "catalog_nbr": "121",
    "descr": "Object-Oriented Programming",
    "units": "3",
    "class_nbr": "12346",
    "class_section": "02",
    "instructor": "Staff",
    "meeting_days": "",
    "start_time": "",
    "end_time": "",
    "building": "",
    "room": "",
    "instruction_mode": "OL",
    "enrollment_status": "W"
  },
  {
    "subject": "CPSC",
    "catalog_nbr": "131",
    "descr": "Data Structures",
    "units": "3",
    "class_nbr": "12400",
    "class_section": "01",
    "instructor": "Ito,K",
    "meeting_days": "TuTh",
    "start_time": "1:00PM",
    "end_time": "2:15PM",
    "building": "EC",
    "room": "109",
    "instruction_mode": "HY",
    "enrollment_status": "C"
  },
  {
    "subject": "CPSC",
    "catalog_nbr": "999",
    "descr": "Broken Record",
    "units": "3",
    "class_nbr": "99999",
    "class_section": "01",
    "instructor": "",
    "meeting_days": "MoXx",
    "start_time": "10:00AM",
    "end_time": "10:50AM",
    "building": "",
    "room": "",
    "instruction_mode": "P",
    "enrollment_status": "O"
  }
]
```

Row 2 is a second meeting pattern (lab) for section 12345. Row 5 is intentionally malformed to test per-record failure isolation.

- [ ] **Step 2: Append failing tests to `scrapers/csuf/tests/parse.test.ts`**

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClassRows } from '../src/parse';
import type { RawClassRow } from '../src/types';

const fixture: RawClassRow[] = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cpsc.json'),
    'utf8',
  ),
);

describe('parseClassRows', () => {
  it('groups rows into courses and sections with merged meeting patterns', () => {
    const { courses } = parseClassRows(fixture);
    expect(courses).toHaveLength(2); // CPSC 121, CPSC 131 (999 skipped)
    const cpsc121 = courses.find((c) => c.catalogNbr === '121')!;
    expect(cpsc121.sections).toHaveLength(2);
    const s1 = cpsc121.sections.find((s) => s.classNbr === '12345')!;
    expect(s1.meetings).toHaveLength(2); // lecture + lab
    expect(s1.meetings[0]).toEqual({
      days: ['M', 'W', 'F'],
      startMin: 600,
      endMin: 650,
      building: 'CS',
      room: '101',
    });
    expect(s1.instructorName).toBe('Lee,J');
  });

  it('maps online sections with no meetings and normalizes Staff/blank instructor to null', () => {
    const { courses } = parseClassRows(fixture);
    const online = courses
      .find((c) => c.catalogNbr === '121')!
      .sections.find((s) => s.classNbr === '12346')!;
    expect(online.meetings).toEqual([]);
    expect(online.mode).toBe('online');
    expect(online.enrollmentStatus).toBe('waitlist');
    expect(online.instructorName).toBeNull();
  });

  it('maps hybrid mode and closed status', () => {
    const { courses } = parseClassRows(fixture);
    const s = courses.find((c) => c.catalogNbr === '131')!.sections[0];
    expect(s.mode).toBe('hybrid');
    expect(s.enrollmentStatus).toBe('closed');
  });

  it('isolates malformed rows into skipped with error messages', () => {
    const { skipped } = parseClassRows(fixture);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].row.catalog_nbr).toBe('999');
    expect(skipped[0].error).toMatch(/unrecognized/i);
  });
});
```

- [ ] **Step 3: Run tests to verify new ones fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test`
Expected: FAIL — `parseClassRows` not exported.

- [ ] **Step 4: Add to `scrapers/csuf/src/parse.ts`**

```ts
import type { RawClassRow, ScrapedCourse, ScrapedSection } from './types';

const MODE_MAP: Record<string, ScrapedSection['mode']> = {
  P: 'in-person',
  OL: 'online',
  HY: 'hybrid',
};

const STATUS_MAP: Record<string, ScrapedSection['enrollmentStatus']> = {
  O: 'open',
  C: 'closed',
  W: 'waitlist',
};

export interface ParseResult {
  courses: ScrapedCourse[];
  skipped: Array<{ row: RawClassRow; error: string }>;
}

export function parseClassRows(rows: RawClassRow[]): ParseResult {
  const courses = new Map<string, ScrapedCourse>();
  const sections = new Map<string, ScrapedSection>();
  const skipped: ParseResult['skipped'] = [];

  for (const row of rows) {
    try {
      // Parse fallible fields BEFORE registering anything, so a bad row
      // leaves no partial course/section behind.
      const days = parseDays(row.meeting_days);
      const startMin = parseTime(row.start_time);
      const endMin = parseTime(row.end_time);
      const units = parseUnits(row.units);
      const mode = MODE_MAP[row.instruction_mode];
      if (!mode) throw new Error(`unknown instruction_mode "${row.instruction_mode}"`);
      const status = STATUS_MAP[row.enrollment_status];
      if (!status) throw new Error(`unknown enrollment_status "${row.enrollment_status}"`);

      const courseKey = `${row.subject} ${row.catalog_nbr}`;
      let course = courses.get(courseKey);
      if (!course) {
        course = {
          deptCode: row.subject,
          catalogNbr: row.catalog_nbr,
          title: row.descr,
          units,
          sections: [],
        };
        courses.set(courseKey, course);
      }

      const sectionKey = `${courseKey}#${row.class_nbr}`;
      let section = sections.get(sectionKey);
      if (!section) {
        const instructor = row.instructor.trim();
        section = {
          classNbr: row.class_nbr,
          sectionCode: row.class_section,
          instructorName: instructor === '' || instructor === 'Staff' ? null : instructor,
          mode,
          enrollmentStatus: status,
          meetings: [],
        };
        sections.set(sectionKey, section);
        course.sections.push(section);
      }

      if (days.length > 0 && startMin !== null && endMin !== null) {
        section.meetings.push({
          days,
          startMin,
          endMin,
          building: row.building.trim() === '' ? null : row.building,
          room: row.room.trim() === '' ? null : row.room,
        });
      }
    } catch (err) {
      skipped.push({ row, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // A course whose every row failed was never registered (or registered with
  // zero sections) — drop empty shells.
  const kept = [...courses.values()].filter((c) => c.sections.length > 0);
  return { courses: kept, skipped };
}

function parseUnits(raw: string): number {
  const first = raw.split('-')[0].trim();
  const units = Number(first);
  if (Number.isNaN(units)) throw new Error(`invalid units "${raw}"`);
  return units;
}
```

- [ ] **Step 5: Update `scrapers/csuf/src/index.ts`**

```ts
export { parseDays, parseTime, parseClassRows } from './parse';
export type { ParseResult } from './parse';
export type {
  RawClassRow,
  ScrapedMeeting,
  ScrapedSection,
  ScrapedCourse,
} from './types';
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx pnpm --filter @csufsched/scraper-csuf test` then `npx pnpm --filter @csufsched/scraper-csuf typecheck`
Expected: PASS (10 tests) / no errors.

- [ ] **Step 7: Commit**

```bash
git add scrapers/csuf/src/parse.ts scrapers/csuf/src/index.ts scrapers/csuf/tests/parse.test.ts scrapers/csuf/tests/fixtures/cpsc.json
git commit -m "feat: parse PeopleSoft class rows into scraped course structures"
```

---

### Task 7: Rate limiter + fetch with backoff

**Files:**
- Create: `scrapers/csuf/src/rateLimit.ts`
- Modify: `scrapers/csuf/src/index.ts`
- Test: `scrapers/csuf/tests/rateLimit.test.ts`

- [ ] **Step 1: Write failing tests in `scrapers/csuf/tests/rateLimit.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimited, fetchWithBackoff } from '../src/rateLimit';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimited', () => {
  it('spaces calls by at least the minimum interval', async () => {
    const calls: number[] = [];
    const fn = rateLimited(async () => {
      calls.push(Date.now());
    }, 1000);

    const p1 = fn();
    const p2 = fn();
    const p3 = fn();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(3);
    await Promise.all([p1, p2, p3]);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(1000);
    expect(calls[2] - calls[1]).toBeGreaterThanOrEqual(1000);
  });
});

describe('fetchWithBackoff', () => {
  it('returns immediately on ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const res = await fetchWithBackoff('https://x.test/a', mockFetch, { retries: 3, baseDelayMs: 100 });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries with exponential delay on 429/5xx, then succeeds', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const promise = fetchWithBackoff('https://x.test/a', mockFetch, { retries: 3, baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100); // after 1st failure
    await vi.advanceTimersByTimeAsync(200); // after 2nd failure
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
    const promise = fetchWithBackoff('https://x.test/a', mockFetch, { retries: 2, baseDelayMs: 100 });
    const assertion = expect(promise).rejects.toThrow(/503/);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry 4xx other than 429', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('gone', { status: 404 }));
    await expect(
      fetchWithBackoff('https://x.test/a', mockFetch, { retries: 3, baseDelayMs: 100 }),
    ).rejects.toThrow(/404/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test`
Expected: FAIL — cannot resolve `../src/rateLimit`.

- [ ] **Step 3: Create `scrapers/csuf/src/rateLimit.ts`**

```ts
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function rateLimited<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  minIntervalMs: number,
): (...args: A) => Promise<R> {
  let chain: Promise<unknown> = Promise.resolve();
  return (...args: A): Promise<R> => {
    const result = chain.then(() => fn(...args));
    chain = result.catch(() => undefined).then(() => sleep(minIntervalMs));
    return result;
  };
}

export interface BackoffOptions {
  retries: number;
  baseDelayMs: number;
}

export async function fetchWithBackoff(
  url: string,
  fetchFn: FetchLike,
  opts: BackoffOptions,
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const res = await fetchFn(url);
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

- [ ] **Step 4: Update `scrapers/csuf/src/index.ts`** — add:

```ts
export { rateLimited, fetchWithBackoff } from './rateLimit';
export type { FetchLike, BackoffOptions } from './rateLimit';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx pnpm --filter @csufsched/scraper-csuf test` then `npx pnpm --filter @csufsched/scraper-csuf typecheck`
Expected: PASS (15 tests) / no errors.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/rateLimit.ts scrapers/csuf/src/index.ts scrapers/csuf/tests/rateLimit.test.ts
git commit -m "feat: add rate limiter and fetch backoff for polite scraping"
```

---

### Task 8: CSUF scrape runner (orchestration + persistence + summary)

**Files:**
- Create: `scrapers/csuf/src/run.ts`
- Modify: `scrapers/csuf/src/index.ts`
- Test: `scrapers/csuf/tests/run.test.ts`

`scrapeTerm` is dependency-injected (fetch + persistence callbacks) so it is fully unit-testable without network or DB. The CLI wires real fetch + `@csufsched/db` upserts.

- [ ] **Step 1: Write failing tests in `scrapers/csuf/tests/run.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { scrapeTerm } from '../src/run';
import type { RawClassRow } from '../src/types';

function row(overrides: Partial<RawClassRow>): RawClassRow {
  return {
    subject: 'CPSC',
    catalog_nbr: '121',
    descr: 'OOP',
    units: '3',
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

describe('scrapeTerm', () => {
  it('fetches each department, persists parsed courses, and reports a summary', async () => {
    const fetchRows = vi
      .fn()
      .mockResolvedValueOnce([row({}), row({ class_nbr: '12346', class_section: '02' })])
      .mockResolvedValueOnce([row({ subject: 'MATH', catalog_nbr: '150B', descr: 'Calc II', units: '4', class_nbr: '20001' })]);
    const persistCourse = vi.fn().mockResolvedValue(undefined);

    const summary = await scrapeTerm({
      departments: ['CPSC', 'MATH'],
      fetchRows,
      persistCourse,
    });

    expect(fetchRows).toHaveBeenCalledWith('CPSC');
    expect(fetchRows).toHaveBeenCalledWith('MATH');
    expect(persistCourse).toHaveBeenCalledTimes(2);
    expect(summary.departmentsScraped).toBe(2);
    expect(summary.coursesPersisted).toBe(2);
    expect(summary.rowsSkipped).toHaveLength(0);
    expect(summary.departmentErrors).toHaveLength(0);
  });

  it('a department fetch failure is recorded, not thrown, and other departments continue', async () => {
    const fetchRows = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([row({})]);
    const persistCourse = vi.fn().mockResolvedValue(undefined);

    const summary = await scrapeTerm({ departments: ['CPSC', 'MATH'], fetchRows, persistCourse });

    expect(summary.departmentErrors).toEqual([{ dept: 'CPSC', error: 'boom' }]);
    expect(summary.coursesPersisted).toBe(1);
  });

  it('a persist failure for one course is recorded and does not abort the run', async () => {
    const fetchRows = vi
      .fn()
      .mockResolvedValueOnce([
        row({}),
        row({ catalog_nbr: '131', descr: 'Data Structures', class_nbr: '12400' }),
      ]);
    const persistCourse = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);

    const summary = await scrapeTerm({ departments: ['CPSC'], fetchRows, persistCourse });

    expect(summary.coursesPersisted).toBe(1);
    expect(summary.courseErrors).toEqual([{ course: 'CPSC 121', error: 'db down' }]);
  });

  it('malformed rows surface in rowsSkipped', async () => {
    const fetchRows = vi.fn().mockResolvedValueOnce([row({ meeting_days: 'MoXx' })]);
    const persistCourse = vi.fn();

    const summary = await scrapeTerm({ departments: ['CPSC'], fetchRows, persistCourse });

    expect(summary.rowsSkipped).toHaveLength(1);
    expect(summary.rowsSkipped[0].error).toMatch(/unrecognized/i);
    expect(persistCourse).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @csufsched/scraper-csuf test`
Expected: FAIL — cannot resolve `../src/run`.

- [ ] **Step 3: Create `scrapers/csuf/src/run.ts`**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPool,
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  replaceMeetings,
  upsertProfessor,
} from '@csufsched/db';
import { parseClassRows } from './parse';
import { rateLimited, fetchWithBackoff } from './rateLimit';
import type { RawClassRow, ScrapedCourse } from './types';

export interface ScrapeSummary {
  departmentsScraped: number;
  coursesPersisted: number;
  rowsSkipped: Array<{ row: RawClassRow; error: string }>;
  departmentErrors: Array<{ dept: string; error: string }>;
  courseErrors: Array<{ course: string; error: string }>;
}

export interface ScrapeTermOptions {
  departments: string[];
  fetchRows: (dept: string) => Promise<RawClassRow[]>;
  persistCourse: (course: ScrapedCourse) => Promise<void>;
}

export async function scrapeTerm(opts: ScrapeTermOptions): Promise<ScrapeSummary> {
  const summary: ScrapeSummary = {
    departmentsScraped: 0,
    coursesPersisted: 0,
    rowsSkipped: [],
    departmentErrors: [],
    courseErrors: [],
  };

  for (const dept of opts.departments) {
    let rows: RawClassRow[];
    try {
      rows = await opts.fetchRows(dept);
    } catch (err) {
      summary.departmentErrors.push({
        dept,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    summary.departmentsScraped += 1;

    const { courses, skipped } = parseClassRows(rows);
    summary.rowsSkipped.push(...skipped);

    for (const course of courses) {
      try {
        await opts.persistCourse(course);
        summary.coursesPersisted += 1;
      } catch (err) {
        summary.courseErrors.push({
          course: `${course.deptCode} ${course.catalogNbr}`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return summary;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const databaseUrl = process.env.DATABASE_URL;
  const searchUrl = process.env.CSUF_SEARCH_URL;
  const termCode = process.env.TERM_CODE;
  const termName = process.env.TERM_NAME ?? termCode;
  const departments = (process.env.DEPARTMENTS ?? '').split(',').filter(Boolean);
  if (!databaseUrl || !searchUrl || !termCode || departments.length === 0) {
    console.error('Required env: DATABASE_URL, CSUF_SEARCH_URL, TERM_CODE, DEPARTMENTS (comma-separated)');
    process.exit(1);
  }

  const pool = createPool(databaseUrl);
  const limitedFetch = rateLimited(
    (url: string) => fetchWithBackoff(url, fetch, { retries: 3, baseDelayMs: 1000 }),
    1000,
  );

  const fetchRows = async (dept: string): Promise<RawClassRow[]> => {
    const url = `${searchUrl}?term=${encodeURIComponent(termCode)}&subject=${encodeURIComponent(dept)}`;
    const res = await limitedFetch(url);
    return (await res.json()) as RawClassRow[];
  };

  const run = async (): Promise<void> => {
    const termId = await upsertTerm(pool, { code: termCode, name: termName ?? termCode });
    const deptIds = new Map<string, number>();

    const persistCourse = async (course: ScrapedCourse): Promise<void> => {
      let deptId = deptIds.get(course.deptCode);
      if (deptId === undefined) {
        deptId = await upsertDepartment(pool, { code: course.deptCode, name: course.deptCode });
        deptIds.set(course.deptCode, deptId);
      }
      const courseId = await upsertCourse(pool, {
        termId,
        deptId,
        catalogNbr: course.catalogNbr,
        title: course.title,
        units: course.units,
        description: null,
      });
      for (const s of course.sections) {
        const instructorId =
          s.instructorName === null ? null : await upsertProfessor(pool, { fullName: s.instructorName });
        const sectionId = await upsertSection(pool, {
          courseId,
          classNbr: s.classNbr,
          sectionCode: s.sectionCode,
          instructorId,
          mode: s.mode,
          enrollmentStatus: s.enrollmentStatus,
        });
        await replaceMeetings(pool, sectionId, s.meetings);
      }
    };

    const summary = await scrapeTerm({ departments, fetchRows, persistCourse });
    console.log(JSON.stringify(summary, null, 2));
  };

  run()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Update `scrapers/csuf/src/index.ts`** — add:

```ts
export { scrapeTerm } from './run';
export type { ScrapeSummary, ScrapeTermOptions } from './run';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx pnpm --filter @csufsched/scraper-csuf test` then `npx pnpm --filter @csufsched/scraper-csuf typecheck`
Expected: PASS (19 tests) / no errors.

- [ ] **Step 6: Commit**

```bash
git add scrapers/csuf/src/run.ts scrapers/csuf/src/index.ts scrapers/csuf/tests/run.test.ts
git commit -m "feat: add CSUF scrape orchestrator with failure isolation and summary"
```

---

### Task 9: RMP scraper scaffold + teacher parser

**Files:**
- Create: `scrapers/rmp/package.json`
- Create: `scrapers/rmp/tsconfig.json`
- Create: `scrapers/rmp/src/types.ts`
- Create: `scrapers/rmp/src/parse.ts`
- Create: `scrapers/rmp/src/index.ts`
- Create: `scrapers/rmp/tests/fixtures/teachers.json`
- Test: `scrapers/rmp/tests/parse.test.ts`

- [ ] **Step 1: Create `scrapers/rmp/package.json`**

```json
{
  "name": "@csufsched/scraper-rmp",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "scrape": "node --experimental-strip-types src/run.ts"
  },
  "dependencies": {
    "@csufsched/db": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `scrapers/rmp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Run `npx pnpm install`**

- [ ] **Step 4: Create `scrapers/rmp/src/types.ts`**

```ts
// Node shape from RMP GraphQL newSearch.teachers.edges[].node
export interface RawTeacherNode {
  id: string; // base64 graphql id, e.g. "VGVhY2hlci0xMjM0"
  legacyId: number; // numeric id used in profile URLs
  firstName: string;
  lastName: string;
  avgRating: number | null;
  avgDifficulty: number | null;
  wouldTakeAgainPercent: number | null; // -1 when unknown
  numRatings: number;
  teacherRatingTags: Array<{ tagName: string; tagCount: number }>;
}

export interface RmpTeacher {
  rmpId: string;
  legacyId: number;
  firstName: string;
  lastName: string;
  rating: number | null;
  difficulty: number | null;
  wouldTakeAgainPct: number | null;
  numRatings: number;
  rmpUrl: string;
  tags: Array<{ tag: string; count: number }>;
}
```

- [ ] **Step 5: Create fixture `scrapers/rmp/tests/fixtures/teachers.json`**

```json
[
  {
    "id": "VGVhY2hlci0x",
    "legacyId": 1,
    "firstName": "John",
    "lastName": "Lee",
    "avgRating": 4.2,
    "avgDifficulty": 2.1,
    "wouldTakeAgainPercent": 78,
    "numRatings": 55,
    "teacherRatingTags": [
      { "tagName": "Clear lectures", "tagCount": 12 },
      { "tagName": "Low homework", "tagCount": 9 },
      { "tagName": "Caring", "tagCount": 3 }
    ]
  },
  {
    "id": "VGVhY2hlci0y",
    "legacyId": 2,
    "firstName": "Jane",
    "lastName": "Lee",
    "avgRating": 3.1,
    "avgDifficulty": 3.8,
    "wouldTakeAgainPercent": -1,
    "numRatings": 4,
    "teacherRatingTags": []
  },
  {
    "id": "VGVhY2hlci0z",
    "legacyId": 3,
    "firstName": "Kenji",
    "lastName": "Ito",
    "avgRating": null,
    "avgDifficulty": null,
    "wouldTakeAgainPercent": -1,
    "numRatings": 0,
    "teacherRatingTags": []
  }
]
```

- [ ] **Step 6: Write failing tests in `scrapers/rmp/tests/parse.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapTeacherNode } from '../src/parse';
import type { RawTeacherNode } from '../src/types';

const fixture: RawTeacherNode[] = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'teachers.json'),
    'utf8',
  ),
);

describe('mapTeacherNode', () => {
  it('maps a full teacher node with sorted top tags', () => {
    const t = mapTeacherNode(fixture[0]);
    expect(t).toEqual({
      rmpId: 'VGVhY2hlci0x',
      legacyId: 1,
      firstName: 'John',
      lastName: 'Lee',
      rating: 4.2,
      difficulty: 2.1,
      wouldTakeAgainPct: 78,
      numRatings: 55,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/1',
      tags: [
        { tag: 'Clear lectures', count: 12 },
        { tag: 'Low homework', count: 9 },
        { tag: 'Caring', count: 3 },
      ],
    });
  });

  it('normalizes wouldTakeAgainPercent -1 to null', () => {
    expect(mapTeacherNode(fixture[1]).wouldTakeAgainPct).toBeNull();
  });

  it('keeps null rating for unrated teachers', () => {
    const t = mapTeacherNode(fixture[2]);
    expect(t.rating).toBeNull();
    expect(t.difficulty).toBeNull();
    expect(t.numRatings).toBe(0);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx pnpm --filter @csufsched/scraper-rmp test`
Expected: FAIL — cannot resolve `../src/parse`.

- [ ] **Step 8: Create `scrapers/rmp/src/parse.ts`**

```ts
import type { RawTeacherNode, RmpTeacher } from './types';

export function mapTeacherNode(node: RawTeacherNode): RmpTeacher {
  return {
    rmpId: node.id,
    legacyId: node.legacyId,
    firstName: node.firstName,
    lastName: node.lastName,
    rating: node.avgRating,
    difficulty: node.avgDifficulty,
    wouldTakeAgainPct:
      node.wouldTakeAgainPercent === null || node.wouldTakeAgainPercent < 0
        ? null
        : node.wouldTakeAgainPercent,
    numRatings: node.numRatings,
    rmpUrl: `https://www.ratemyprofessors.com/professor/${node.legacyId}`,
    tags: [...node.teacherRatingTags]
      .sort((a, b) => b.tagCount - a.tagCount)
      .map((t) => ({ tag: t.tagName, count: t.tagCount })),
  };
}
```

- [ ] **Step 9: Create `scrapers/rmp/src/index.ts`**

```ts
export { mapTeacherNode } from './parse';
export type { RawTeacherNode, RmpTeacher } from './types';
```

- [ ] **Step 10: Run tests + typecheck**

Run: `npx pnpm --filter @csufsched/scraper-rmp test` then `npx pnpm --filter @csufsched/scraper-rmp typecheck`
Expected: PASS (3 tests) / no errors.

- [ ] **Step 11: Commit**

```bash
git add scrapers/rmp pnpm-lock.yaml
git commit -m "feat: scaffold RMP scraper with teacher node parser"
```

---

### Task 10: Name matcher

**Files:**
- Create: `scrapers/rmp/src/match.ts`
- Modify: `scrapers/rmp/src/index.ts`
- Test: `scrapers/rmp/tests/match.test.ts`

CSUF format `"Lee,J"` (Last,FirstInitial — sometimes `"Lee,John"` or with middle initials). Match rule from spec: last name + first initial, case-insensitive, within CSUF school scope. One candidate → matched; several → ambiguous; none → unmatched.

- [ ] **Step 1: Write failing tests in `scrapers/rmp/tests/match.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseCsufName, matchProfessor } from '../src/match';
import type { RmpTeacher } from '../src/types';

function teacher(overrides: Partial<RmpTeacher>): RmpTeacher {
  return {
    rmpId: 'X',
    legacyId: 0,
    firstName: 'John',
    lastName: 'Lee',
    rating: 4,
    difficulty: 2,
    wouldTakeAgainPct: 80,
    numRatings: 10,
    rmpUrl: 'https://www.ratemyprofessors.com/professor/0',
    tags: [],
    ...overrides,
  };
}

describe('parseCsufName', () => {
  it('parses Last,FirstInitial', () => {
    expect(parseCsufName('Lee,J')).toEqual({ last: 'Lee', firstInitial: 'J' });
  });

  it('parses Last,First full name', () => {
    expect(parseCsufName('Lee,John')).toEqual({ last: 'Lee', firstInitial: 'J' });
  });

  it('handles multi-part last names and trims spaces', () => {
    expect(parseCsufName('Van Der Berg, K')).toEqual({ last: 'Van Der Berg', firstInitial: 'K' });
  });

  it('returns null for names without a comma', () => {
    expect(parseCsufName('Staff')).toBeNull();
    expect(parseCsufName('')).toBeNull();
  });
});

describe('matchProfessor', () => {
  const john = teacher({ rmpId: 'A', firstName: 'John', lastName: 'Lee' });
  const jane = teacher({ rmpId: 'B', firstName: 'Jane', lastName: 'Lee' });
  const ito = teacher({ rmpId: 'C', firstName: 'Kenji', lastName: 'Ito' });

  it('matches unique last name + first initial', () => {
    const result = matchProfessor('Ito,K', [john, jane, ito]);
    expect(result).toEqual({ status: 'matched', teacher: ito });
  });

  it('is case-insensitive', () => {
    const result = matchProfessor('ITO,k', [john, jane, ito]);
    expect(result).toEqual({ status: 'matched', teacher: ito });
  });

  it('reports ambiguity when multiple teachers share last name + initial', () => {
    const jack = teacher({ rmpId: 'D', firstName: 'Jack', lastName: 'Lee' });
    const result = matchProfessor('Lee,J', [john, jane, jack, ito]);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates.map((c) => c.rmpId).sort()).toEqual(['A', 'B', 'D']);
    }
  });

  it('distinguishes same last name by initial', () => {
    const result = matchProfessor('Lee,Jane', [john, jane, ito]);
    // Both John and Jane have initial J — ambiguous by the spec rule (initial only)
    expect(result.status).toBe('ambiguous');
  });

  it('returns unmatched when nothing fits', () => {
    expect(matchProfessor('Nguyen,T', [john, jane, ito])).toEqual({ status: 'unmatched' });
    expect(matchProfessor('Staff', [john, jane, ito])).toEqual({ status: 'unmatched' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @csufsched/scraper-rmp test`
Expected: FAIL — cannot resolve `../src/match`.

- [ ] **Step 3: Create `scrapers/rmp/src/match.ts`**

```ts
import type { RmpTeacher } from './types';

export interface ParsedName {
  last: string;
  firstInitial: string;
}

export type MatchResult =
  | { status: 'matched'; teacher: RmpTeacher }
  | { status: 'ambiguous'; candidates: RmpTeacher[] }
  | { status: 'unmatched' };

export function parseCsufName(raw: string): ParsedName | null {
  const commaIdx = raw.indexOf(',');
  if (commaIdx <= 0) return null;
  const last = raw.slice(0, commaIdx).trim();
  const first = raw.slice(commaIdx + 1).trim();
  if (last === '' || first === '') return null;
  return { last, firstInitial: first[0].toUpperCase() };
}

export function matchProfessor(csufName: string, teachers: RmpTeacher[]): MatchResult {
  const parsed = parseCsufName(csufName);
  if (!parsed) return { status: 'unmatched' };
  const candidates = teachers.filter(
    (t) =>
      t.lastName.trim().toLowerCase() === parsed.last.toLowerCase() &&
      t.firstName.trim().charAt(0).toUpperCase() === parsed.firstInitial,
  );
  if (candidates.length === 1) return { status: 'matched', teacher: candidates[0] };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };
  return { status: 'unmatched' };
}
```

- [ ] **Step 4: Update `scrapers/rmp/src/index.ts`** — add:

```ts
export { parseCsufName, matchProfessor } from './match';
export type { ParsedName, MatchResult } from './match';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx pnpm --filter @csufsched/scraper-rmp test` then `npx pnpm --filter @csufsched/scraper-rmp typecheck`
Expected: PASS (12 tests) / no errors.

- [ ] **Step 6: Commit**

```bash
git add scrapers/rmp/src/match.ts scrapers/rmp/src/index.ts scrapers/rmp/tests/match.test.ts
git commit -m "feat: add CSUF-to-RMP professor name matcher"
```

---

### Task 11: RMP runner (fetch, match, persist, ambiguity report) + final checks

**Files:**
- Create: `scrapers/rmp/src/run.ts`
- Modify: `scrapers/rmp/src/index.ts`
- Test: `scrapers/rmp/tests/run.test.ts`

Like Task 8, `updateProfessors` is dependency-injected (teacher list + DB callbacks + report writer) for unit testing; the CLI wires GraphQL fetch + `@csufsched/db`.

- [ ] **Step 1: Write failing tests in `scrapers/rmp/tests/run.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { updateProfessors } from '../src/run';
import type { RmpTeacher } from '../src/types';

function teacher(overrides: Partial<RmpTeacher>): RmpTeacher {
  return {
    rmpId: 'X',
    legacyId: 0,
    firstName: 'John',
    lastName: 'Lee',
    rating: 4,
    difficulty: 2,
    wouldTakeAgainPct: 80,
    numRatings: 10,
    rmpUrl: 'https://www.ratemyprofessors.com/professor/0',
    tags: [{ tag: 'Clear lectures', count: 12 }],
    ...overrides,
  };
}

describe('updateProfessors', () => {
  const john = teacher({ rmpId: 'A', legacyId: 1 });
  const jane = teacher({ rmpId: 'B', legacyId: 2, firstName: 'Jane' });
  const ito = teacher({ rmpId: 'C', legacyId: 3, firstName: 'Kenji', lastName: 'Ito' });

  it('persists matched professors and reports counts', async () => {
    const persistMatch = vi.fn().mockResolvedValue(undefined);
    const summary = await updateProfessors({
      csufNames: ['Ito,K'],
      teachers: [john, jane, ito],
      persistMatch,
    });
    expect(persistMatch).toHaveBeenCalledWith('Ito,K', ito);
    expect(summary.matched).toBe(1);
    expect(summary.ambiguous).toEqual([]);
    expect(summary.unmatched).toEqual([]);
  });

  it('collects ambiguous names with candidate ids for the report file', async () => {
    const persistMatch = vi.fn();
    const summary = await updateProfessors({
      csufNames: ['Lee,J'],
      teachers: [john, jane, ito],
      persistMatch,
    });
    expect(persistMatch).not.toHaveBeenCalled();
    expect(summary.ambiguous).toEqual([
      { name: 'Lee,J', candidates: ['A', 'B'] },
    ]);
  });

  it('collects unmatched names', async () => {
    const persistMatch = vi.fn();
    const summary = await updateProfessors({
      csufNames: ['Nguyen,T', 'Staff'],
      teachers: [john, jane, ito],
      persistMatch,
    });
    expect(summary.unmatched).toEqual(['Nguyen,T', 'Staff']);
  });

  it('a persist failure is recorded and does not abort the run', async () => {
    const persistMatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);
    const summary = await updateProfessors({
      csufNames: ['Ito,K', 'Lee,Jane'],
      teachers: [ito, jane],
      persistMatch,
    });
    expect(summary.matched).toBe(1);
    expect(summary.errors).toEqual([{ name: 'Ito,K', error: 'db down' }]);
  });
});
```

Note for the last test: with teachers `[ito, jane]`, `'Lee,Jane'` uniquely matches Jane (only one Lee with initial J), so it is the second `persistMatch` call.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @csufsched/scraper-rmp test`
Expected: FAIL — cannot resolve `../src/run`.

- [ ] **Step 3: Create `scrapers/rmp/src/run.ts`**

```ts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, upsertProfessor, replaceProfTags } from '@csufsched/db';
import { mapTeacherNode } from './parse';
import { matchProfessor } from './match';
import type { RawTeacherNode, RmpTeacher } from './types';

export interface UpdateSummary {
  matched: number;
  ambiguous: Array<{ name: string; candidates: string[] }>;
  unmatched: string[];
  errors: Array<{ name: string; error: string }>;
}

export interface UpdateProfessorsOptions {
  csufNames: string[];
  teachers: RmpTeacher[];
  persistMatch: (csufName: string, teacher: RmpTeacher) => Promise<void>;
}

export async function updateProfessors(opts: UpdateProfessorsOptions): Promise<UpdateSummary> {
  const summary: UpdateSummary = { matched: 0, ambiguous: [], unmatched: [], errors: [] };

  for (const name of opts.csufNames) {
    const result = matchProfessor(name, opts.teachers);
    if (result.status === 'unmatched') {
      summary.unmatched.push(name);
      continue;
    }
    if (result.status === 'ambiguous') {
      summary.ambiguous.push({ name, candidates: result.candidates.map((c) => c.rmpId) });
      continue;
    }
    try {
      await opts.persistMatch(name, result.teacher);
      summary.matched += 1;
    } catch (err) {
      summary.errors.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

const SEARCH_QUERY = `
query TeacherSearch($schoolID: ID!, $cursor: String) {
  newSearch {
    teachers(query: { text: "", schoolID: $schoolID }, first: 100, after: $cursor) {
      edges { node {
        id legacyId firstName lastName
        avgRating avgDifficulty wouldTakeAgainPercent numRatings
        teacherRatingTags { tagName tagCount }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

interface SearchPage {
  data: {
    newSearch: {
      teachers: {
        edges: Array<{ node: RawTeacherNode }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  };
}

export async function fetchAllTeachers(
  schoolId: string,
  fetchFn: typeof fetch,
): Promise<RmpTeacher[]> {
  const teachers: RmpTeacher[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res = await fetchFn('https://www.ratemyprofessors.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic dGVzdDp0ZXN0',
      },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { schoolID: schoolId, cursor } }),
    });
    if (!res.ok) throw new Error(`RMP fetch failed: ${res.status}`);
    const page = (await res.json()) as SearchPage;
    const conn = page.data.newSearch.teachers;
    teachers.push(...conn.edges.map((e) => mapTeacherNode(e.node)));
    if (!conn.pageInfo.hasNextPage || conn.pageInfo.endCursor === null) break;
    cursor = conn.pageInfo.endCursor;
    await new Promise((resolve) => setTimeout(resolve, 1000)); // polite pacing
  }
  return teachers;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const databaseUrl = process.env.DATABASE_URL;
  const schoolId = process.env.RMP_SCHOOL_ID;
  if (!databaseUrl || !schoolId) {
    console.error('Required env: DATABASE_URL, RMP_SCHOOL_ID');
    process.exit(1);
  }

  const pool = createPool(databaseUrl);

  const run = async (): Promise<void> => {
    const namesRes = await pool.query('SELECT full_name FROM professors ORDER BY full_name');
    const csufNames: string[] = namesRes.rows.map((r) => r.full_name as string);
    const teachers = await fetchAllTeachers(schoolId, fetch);

    const persistMatch = async (csufName: string, teacher: RmpTeacher): Promise<void> => {
      const profId = await upsertProfessor(pool, {
        fullName: csufName,
        rmpId: teacher.rmpId,
        rating: teacher.rating,
        difficulty: teacher.difficulty,
        wouldTakeAgainPct: teacher.wouldTakeAgainPct,
        numRatings: teacher.numRatings,
        rmpUrl: teacher.rmpUrl,
      });
      await replaceProfTags(pool, profId, teacher.tags);
    };

    const summary = await updateProfessors({ csufNames, teachers, persistMatch });

    const reportPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'reports',
      `ambiguous-${new Date().toISOString().slice(0, 10)}.json`,
    );
    if (summary.ambiguous.length > 0) {
      await writeFile(reportPath, JSON.stringify(summary.ambiguous, null, 2));
      console.log(`Ambiguous matches written to ${reportPath}`);
    }
    console.log(JSON.stringify({ ...summary, ambiguous: summary.ambiguous.length }, null, 2));
  };

  run()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Create `scrapers/rmp/reports/.gitkeep`** (empty file) and add `scrapers/rmp/reports/*.json` to `.gitignore`.

- [ ] **Step 5: Update `scrapers/rmp/src/index.ts`** — add:

```ts
export { updateProfessors, fetchAllTeachers } from './run';
export type { UpdateSummary, UpdateProfessorsOptions } from './run';
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx pnpm --filter @csufsched/scraper-rmp test` then `npx pnpm --filter @csufsched/scraper-rmp typecheck`
Expected: PASS (16 tests) / no errors.

- [ ] **Step 7: Workspace-wide final check**

Run from repo root: `npx pnpm test` then `npx pnpm typecheck`
Expected: all packages pass — solver 46, csuf 19, rmp 16, db 2+ (integration skipped without `TEST_DATABASE_URL`).

- [ ] **Step 8: Commit**

```bash
git add scrapers/rmp/src/run.ts scrapers/rmp/src/index.ts scrapers/rmp/tests/run.test.ts scrapers/rmp/reports/.gitkeep .gitignore
git commit -m "feat: add RMP update runner with match persistence and ambiguity report"
```

---

## Post-plan notes

- Real endpoint URLs (`CSUF_SEARCH_URL`, `RMP_SCHOOL_ID`) are env-configured; discovering the live PeopleSoft endpoint shape is an ops task, not a code task. If the live shape differs from `RawClassRow`, update the fixture + parser together.
- `fetchAllTeachers` is intentionally untested (thin I/O wrapper over the tested `mapTeacherNode`); testing it would mock everything it does.
- Plan 3 (Fastify API) will read these tables; Plan 4 (React SPA) consumes the API.
