import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool } from '../src/pool';
import { runMigrations } from '../src/migrate';
import { replaceGeCourseAreas } from '../src/ge';

const TEST_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'test_ge';

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

const sourceUrl = 'https://www.fullerton.edu/general-education/student-info/approved-courses.html';
const sourcePublishedAt = new Date('2026-03-25T00:00:00Z');

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

describe.skipIf(!TEST_URL)('replaceGeCourseAreas (integration)', () => {
  it('persists every course area in a source-backed snapshot', async () => {
    await replaceGeCourseAreas(pool, {
      catalogYear: '2026-2027',
      sourceUrl,
      sourcePublishedAt,
      rows: [
        { area: '1A', subject: 'ENGL', catalogNbr: '101' },
        { area: '3', subject: 'ART', catalogNbr: '101' },
      ],
    });

    const rows = await pool.query(
      `SELECT area, subject, catalog_nbr, source_url, source_published_at
       FROM ge_course_areas WHERE catalog_year = $1 ORDER BY area, subject, catalog_nbr`,
      ['2026-2027'],
    );
    expect(rows.rows).toEqual([
      {
        area: '1A',
        subject: 'ENGL',
        catalog_nbr: '101',
        source_url: sourceUrl,
        source_published_at: sourcePublishedAt,
      },
      {
        area: '3',
        subject: 'ART',
        catalog_nbr: '101',
        source_url: sourceUrl,
        source_published_at: sourcePublishedAt,
      },
    ]);
  });

  it('persists official GE areas 6 and Z', async () => {
    await replaceGeCourseAreas(pool, {
      catalogYear: '2026-2027',
      sourceUrl,
      sourcePublishedAt,
      rows: [
        { area: '6', subject: 'HIST', catalogNbr: '110A' },
        { area: 'Z', subject: 'KNES', catalogNbr: '100' },
      ],
    });

    const rows = await pool.query(
      `SELECT area, subject, catalog_nbr FROM ge_course_areas
       WHERE catalog_year = $1 ORDER BY area, subject, catalog_nbr`,
      ['2026-2027'],
    );
    expect(rows.rows).toEqual([
      { area: '6', subject: 'HIST', catalog_nbr: '110A' },
      { area: 'Z', subject: 'KNES', catalog_nbr: '100' },
    ]);
  });

  it('removes rows absent from a later complete snapshot', async () => {
    await replaceGeCourseAreas(pool, {
      catalogYear: '2027-2028',
      sourceUrl,
      sourcePublishedAt,
      rows: [
        { area: '1A', subject: 'ENGL', catalogNbr: '101' },
        { area: '3', subject: 'ART', catalogNbr: '101' },
      ],
    });
    await replaceGeCourseAreas(pool, {
      catalogYear: '2027-2028',
      sourceUrl,
      sourcePublishedAt,
      rows: [{ area: '1A', subject: 'ENGL', catalogNbr: '101' }],
    });

    const rows = await pool.query(
      `SELECT area, subject, catalog_nbr FROM ge_course_areas
       WHERE catalog_year = $1 ORDER BY area, subject, catalog_nbr`,
      ['2027-2028'],
    );
    expect(rows.rows).toEqual([{ area: '1A', subject: 'ENGL', catalog_nbr: '101' }]);
  });

  it('rejects duplicate area-course input before writing a snapshot', async () => {
    await expect(replaceGeCourseAreas(pool, {
      catalogYear: '2028-2029',
      sourceUrl,
      sourcePublishedAt,
      rows: [
        { area: '1A', subject: 'ENGL', catalogNbr: '101' },
        { area: '1A', subject: 'ENGL', catalogNbr: '101' },
      ],
    })).rejects.toThrow('Duplicate GE course area');
  });

  it('rejects an empty snapshot without deleting the prior rows', async () => {
    await replaceGeCourseAreas(pool, {
      catalogYear: '2029-2030',
      sourceUrl,
      sourcePublishedAt,
      rows: [{ area: '1A', subject: 'ENGL', catalogNbr: '101' }],
    });

    await expect(replaceGeCourseAreas(pool, {
      catalogYear: '2029-2030',
      sourceUrl,
      sourcePublishedAt,
      rows: [],
    })).rejects.toThrow('GE snapshot must contain at least one row');

    const rows = await pool.query(
      'SELECT area, subject, catalog_nbr FROM ge_course_areas WHERE catalog_year = $1',
      ['2029-2030'],
    );
    expect(rows.rows).toEqual([{ area: '1A', subject: 'ENGL', catalog_nbr: '101' }]);
  });

  it.each([
    ['an invalid catalog year', { catalogYear: '2026' }],
    ['an unofficial source URL', { sourceUrl: 'https://example.com/ge.html' }],
    ['an invalid source publication date', { sourcePublishedAt: new Date('invalid') }],
    ['an invalid GE area', { rows: [{ area: 'all', subject: 'ENGL', catalogNbr: '101' }] }],
    ['a non-string GE area', { rows: [{ area: 3 as unknown as string, subject: 'ART', catalogNbr: '101' }] }],
    ['an invalid subject', { rows: [{ area: '1A', subject: 'English', catalogNbr: '101' }] }],
    ['an invalid catalog number', { rows: [{ area: '1A', subject: 'ENGL', catalogNbr: '101!' }] }],
  ])('rejects %s without deleting a verified snapshot', async (_label, invalid) => {
    const catalogYear = '2030-2031';
    await replaceGeCourseAreas(pool, {
      catalogYear,
      sourceUrl,
      sourcePublishedAt,
      rows: [{ area: '1A', subject: 'ENGL', catalogNbr: '101' }],
    });

    await expect(replaceGeCourseAreas(pool, {
      catalogYear,
      sourceUrl,
      sourcePublishedAt,
      rows: [{ area: '3', subject: 'ART', catalogNbr: '101' }],
      ...invalid,
    })).rejects.toThrow('Invalid GE snapshot');

    const rows = await pool.query(
      'SELECT area, subject, catalog_nbr FROM ge_course_areas WHERE catalog_year = $1',
      [catalogYear],
    );
    expect(rows.rows).toEqual([{ area: '1A', subject: 'ENGL', catalog_nbr: '101' }]);
  });

  it('serializes complete snapshots for the same catalog year', async () => {
    const catalogYear = '2031-2032';
    const lockHolder = await pool.connect();
    try {
      await lockHolder.query('BEGIN');
      await lockHolder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [catalogYear]);

      let settled = false;
      const replacement = replaceGeCourseAreas(pool, {
        catalogYear,
        sourceUrl,
        sourcePublishedAt,
        rows: [{ area: '3', subject: 'ART', catalogNbr: '101' }],
      });
      void replacement.then(() => { settled = true; });

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(settled).toBe(false);

      await lockHolder.query('COMMIT');
      await replacement;
    } finally {
      await lockHolder.query('ROLLBACK').catch(() => {});
      lockHolder.release();
    }

    const rows = await pool.query(
      'SELECT area, subject, catalog_nbr FROM ge_course_areas WHERE catalog_year = $1',
      [catalogYear],
    );
    expect(rows.rows).toEqual([{ area: '3', subject: 'ART', catalog_nbr: '101' }]);
  });
});
