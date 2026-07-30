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
  deleteCoursesNotIn,
  deleteSectionsNotIn,
  updateSectionStatuses,
  countSectionsForTerm,
} from '../src/upserts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'test_upserts';

// Every package's integration tests share one TEST_DATABASE_URL and run
// concurrently, so this file migrates into a scratch schema of its own rather
// than wiping `public` out from under its neighbours.
function scopedUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${schema}`);
  return parsed.toString();
}

async function resetSchema(schema: string, recreate: boolean): Promise<void> {
  const admin = createPool(TEST_URL!);
  try {
    await admin.query(
      `DROP SCHEMA IF EXISTS ${schema} CASCADE${recreate ? `; CREATE SCHEMA ${schema}` : ''}`,
    );
  } finally {
    await admin.end();
  }
}

let pool: pg.Pool;

beforeAll(async () => {
  if (!TEST_URL) return;
  await resetSchema(SCHEMA, true);
  pool = createPool(scopedUrl(TEST_URL, SCHEMA));
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  await runMigrations(pool, dir);
});

afterAll(async () => {
  if (!TEST_URL) return;
  await pool.end();
  await resetSchema(SCHEMA, false);
});

describe.skipIf(!TEST_URL)('upserts (integration)', () => {

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

describe.skipIf(!TEST_URL)('transactional swap', () => {
  it('keeps section ids stable across a re-scrape and prunes what vanished', async () => {
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
    }
  });
});
