import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import {
  createPool,
  runMigrations,
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  replaceMeetings,
  upsertProfessor,
  replaceProfTags,
} from '@csufsched/db';
import { makeQueries, type ApiQueries } from '../src/queries';

const TEST_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_URL)('queries (integration)', () => {
  let pool: pg.Pool;
  let q: ApiQueries;
  let termId: number;
  let profId: number;
  let cpsc121Sec01: number;
  let cpsc121Sec02: number;
  let math150bSec01: number;

  beforeAll(async () => {
    pool = createPool(TEST_URL!);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const dir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', 'db', 'migrations',
    );
    await runMigrations(pool, dir);

    termId = await upsertTerm(pool, { code: '2268', name: 'Fall 2026' });
    const cpscId = await upsertDepartment(pool, { code: 'CPSC', name: 'Computer Science' });
    const mathId = await upsertDepartment(pool, { code: 'MATH', name: 'Mathematics' });
    await upsertDepartment(pool, { code: 'ART', name: 'Art' }); // no courses this term

    profId = await upsertProfessor(pool, {
      fullName: 'Lee,J',
      rmpId: 'T1',
      rating: 4.2,
      difficulty: 2.1,
      wouldTakeAgainPct: 78,
      numRatings: 55,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/1',
    });
    await replaceProfTags(pool, profId, [
      { tag: 'clear lectures', count: 12 },
      { tag: 'lots of homework', count: 3 },
      { tag: 'caring', count: 8 },
      { tag: 'tough grader', count: 5 },
    ]);

    const cpsc121 = await upsertCourse(pool, {
      termId, deptId: cpscId, catalogNbr: '121',
      title: 'Object-Oriented Programming', units: 3, description: null,
    });
    const cpsc131 = await upsertCourse(pool, {
      termId, deptId: cpscId, catalogNbr: '131',
      title: 'Data Structures', units: 3, description: null,
    });
    const math150b = await upsertCourse(pool, {
      termId, deptId: mathId, catalogNbr: '150B',
      title: 'Calculus II', units: 4, description: null,
    });

    cpsc121Sec01 = await upsertSection(pool, {
      courseId: cpsc121, classNbr: '11111', sectionCode: '01',
      instructorId: profId, mode: 'in-person', enrollmentStatus: 'open',
    });
    await replaceMeetings(pool, cpsc121Sec01, [
      { days: ['M', 'W'], startMin: 600, endMin: 675, building: 'CS', room: '101' },
    ]);
    cpsc121Sec02 = await upsertSection(pool, {
      courseId: cpsc121, classNbr: '11112', sectionCode: '02',
      instructorId: null, mode: 'online', enrollmentStatus: 'open',
    });
    await upsertSection(pool, {
      courseId: cpsc131, classNbr: '22222', sectionCode: '01',
      instructorId: null, mode: 'in-person', enrollmentStatus: 'waitlist',
    });
    math150bSec01 = await upsertSection(pool, {
      courseId: math150b, classNbr: '33333', sectionCode: '01',
      instructorId: profId, mode: 'hybrid', enrollmentStatus: 'open',
    });

    q = makeQueries(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('listTerms returns terms', async () => {
    const terms = await q.listTerms();
    expect(terms).toEqual([{ id: termId, code: '2268', name: 'Fall 2026' }]);
  });

  it('termExists distinguishes known and unknown ids', async () => {
    expect(await q.termExists(termId)).toBe(true);
    expect(await q.termExists(999999)).toBe(false);
  });

  it('listDepartments returns only departments with courses in the term', async () => {
    const depts = await q.listDepartments(termId);
    expect(depts.map((d) => d.code)).toEqual(['CPSC', 'MATH']);
  });

  it('listCourses nests sections, meetings, and professor summary', async () => {
    const courses = await q.listCourses(termId, 'CPSC', null);
    expect(courses.map((c) => c.catalogNbr)).toEqual(['121', '131']);
    const c121 = courses[0];
    expect(c121.sections).toHaveLength(2);
    const sec01 = c121.sections.find((s) => s.sectionCode === '01')!;
    expect(sec01.professor).toEqual({
      id: profId,
      fullName: 'Lee,J',
      rating: expect.closeTo(4.2, 5),
      difficulty: expect.closeTo(2.1, 5),
      wouldTakeAgainPct: 78,
      topTags: ['clear lectures', 'caring', 'tough grader'],
    });
    expect(sec01.meetings).toEqual([
      { days: ['M', 'W'], startMin: 600, endMin: 675, building: 'CS', room: '101' },
    ]);
    const sec02 = c121.sections.find((s) => s.sectionCode === '02')!;
    expect(sec02.professor).toBeNull();
    expect(sec02.meetings).toEqual([]);
  });

  it('listCourses filters by q on catalog number prefix or title substring', async () => {
    const byNbr = await q.listCourses(termId, 'CPSC', '12');
    expect(byNbr.map((c) => c.catalogNbr)).toEqual(['121']);
    const byTitle = await q.listCourses(termId, 'CPSC', 'data');
    expect(byTitle.map((c) => c.catalogNbr)).toEqual(['131']);
    const none = await q.listCourses(termId, 'CPSC', 'zzz');
    expect(none).toEqual([]);
  });

  it('getProfessorDetail returns full detail with all tags sorted by count', async () => {
    const detail = await q.getProfessorDetail(profId);
    expect(detail).not.toBeNull();
    expect(detail!.fullName).toBe('Lee,J');
    expect(detail!.numRatings).toBe(55);
    expect(detail!.rmpUrl).toBe('https://www.ratemyprofessors.com/professor/1');
    expect(detail!.tags.map((t) => t.tag)).toEqual([
      'clear lectures', 'caring', 'tough grader', 'lots of homework',
    ]);
    expect(await q.getProfessorDetail(999999)).toBeNull();
  });

  it('listSectionsByIds resolves sections across courses; null when any id is unknown', async () => {
    const resolved = await q.listSectionsByIds([cpsc121Sec01, math150bSec01]);
    expect(resolved).not.toBeNull();
    expect(resolved!.map((c) => c.catalogNbr).sort()).toEqual(['121', '150B']);
    const c121 = resolved!.find((c) => c.catalogNbr === '121')!;
    expect(c121.sections).toHaveLength(1);
    expect(c121.sections[0].id).toBe(cpsc121Sec01);

    expect(await q.listSectionsByIds([cpsc121Sec02, 999999])).toBeNull();
  });

  it('getMeta returns max professor scrape time', async () => {
    await pool.query(`UPDATE professors SET last_scraped_at = '2026-07-20T12:00:00Z'`);
    const meta = await q.getMeta();
    expect(meta.dataFrom).toBe('2026-07-20T12:00:00.000Z');
  });
});
