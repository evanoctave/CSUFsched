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
