import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, runMigrations } from '@csufsched/db';
import { persistTerm } from '../src/persist';
import type { ScrapedCourse } from '../src/types';

const TEST_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'test_persist';

// Every package's integration tests share one TEST_DATABASE_URL and run
// concurrently, so this file migrates into a scratch schema of its own rather
// than reading and writing whatever happens to be in `public`.
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

function course(overrides: Partial<ScrapedCourse> = {}): ScrapedCourse {
  return {
    deptCode: 'ZTST',
    catalogNbr: '101',
    title: 'Intro',
    units: 3,
    sections: [
      {
        classNbr: '90001',
        sectionCode: '01',
        instructorName: 'Ada Lovelace',
        mode: 'in-person',
        enrollmentStatus: 'open',
        meetings: [{ days: ['M', 'W'], startMin: 600, endMin: 650, building: 'CS', room: '101' }],
      },
    ],
    ...overrides,
  };
}

describe.skipIf(!TEST_URL)('persistTerm (integration)', () => {
  beforeAll(async () => {
    await resetSchema(SCHEMA, true);
    const pool = createPool(scopedUrl(TEST_URL!, SCHEMA));
    const dir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', 'db', 'migrations',
    );
    try {
      await runMigrations(pool, dir);
    } finally {
      await pool.end();
    }
  });

  afterAll(async () => {
    await resetSchema(SCHEMA, false);
  });

  it('keeps section ids stable across runs, replaces meetings, and prunes vanished rows', async () => {
    const pool = createPool(scopedUrl(TEST_URL!, SCHEMA));
    try {
      const first = await persistTerm(pool, {
        termCode: '2299',
        termName: 'Test Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [course(), course({ catalogNbr: '102', title: 'Second' })],
        prune: true,
      });
      expect(first.coursesUpserted).toBe(2);
      expect(first.sectionsUpserted).toBe(2);

      const before = await pool.query(
        `SELECT s.id FROM sections s JOIN courses c ON c.id = s.course_id
         JOIN terms t ON t.id = c.term_id WHERE t.code = '2299' AND s.class_nbr = '90001'`,
      );

      const second = await persistTerm(pool, {
        termCode: '2299',
        termName: 'Test Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [
          course({
            sections: [
              {
                classNbr: '90001',
                sectionCode: '01',
                instructorName: 'Ada Lovelace',
                mode: 'online',
                enrollmentStatus: 'closed',
                meetings: [],
              },
            ],
          }),
        ],
        prune: true,
      });

      const after = await pool.query(
        `SELECT s.id, s.enrollment_status, s.mode FROM sections s
         JOIN courses c ON c.id = s.course_id JOIN terms t ON t.id = c.term_id
         WHERE t.code = '2299' AND s.class_nbr = '90001'`,
      );
      expect(after.rows[0].id).toBe(before.rows[0].id);
      expect(after.rows[0].enrollment_status).toBe('closed');
      expect(second.coursesDeleted).toBe(1);

      const meetings = await pool.query('SELECT count(*)::int AS n FROM meetings WHERE section_id = $1', [
        after.rows[0].id,
      ]);
      expect(meetings.rows[0].n).toBe(0);
    } finally {
      await pool.query(`DELETE FROM courses WHERE term_id IN (SELECT id FROM terms WHERE code = '2299')`);
      await pool.query(`DELETE FROM terms WHERE code = '2299'`);
      await pool.query(`DELETE FROM departments WHERE code = 'ZTST'`);
      await pool.query(`DELETE FROM professors WHERE full_name = 'Ada Lovelace'`);
      await pool.end();
    }
  });

  it('refreshes without deleting anything when prune is off', async () => {
    const pool = createPool(scopedUrl(TEST_URL!, SCHEMA));
    try {
      await persistTerm(pool, {
        termCode: '2298',
        termName: 'Partial Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [course(), course({ catalogNbr: '102', title: 'Second' })],
        prune: true,
      });

      const second = await persistTerm(pool, {
        termCode: '2298',
        termName: 'Partial Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [course({ title: 'Intro Revised' })],
        prune: false,
      });

      expect(second.coursesDeleted).toBe(0);
      expect(second.sectionsDeleted).toBe(0);

      const kept = await pool.query(
        `SELECT c.catalog_nbr, c.title FROM courses c JOIN terms t ON t.id = c.term_id
         WHERE t.code = '2298' ORDER BY c.catalog_nbr`,
      );
      expect(kept.rows.map((r) => r.catalog_nbr)).toEqual(['101', '102']);
      expect(kept.rows[0].title).toBe('Intro Revised');
    } finally {
      await pool.query(`DELETE FROM courses WHERE term_id IN (SELECT id FROM terms WHERE code = '2298')`);
      await pool.query(`DELETE FROM terms WHERE code = '2298'`);
      await pool.query(`DELETE FROM departments WHERE code = 'ZTST'`);
      await pool.query(`DELETE FROM professors WHERE full_name = 'Ada Lovelace'`);
      await pool.end();
    }
  });

  it('leaves the previous catalog untouched when a write fails mid-run', async () => {
    const pool = createPool(scopedUrl(TEST_URL!, SCHEMA));
    try {
      await persistTerm(pool, {
        termCode: '2297',
        termName: 'Rollback Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [course()],
        prune: true,
      });

      // title is NOT NULL, so this write fails inside the transaction
      const bad = course({ catalogNbr: '103', title: null as unknown as string });
      await expect(
        persistTerm(pool, {
          termCode: '2297',
          termName: 'Rollback Term',
          departmentNames: new Map([['ZTST', 'Test Dept']]),
          courses: [course(), bad],
          prune: true,
        }),
      ).rejects.toThrow();

      const survived = await pool.query(
        `SELECT count(*)::int AS n FROM courses c JOIN terms t ON t.id = c.term_id WHERE t.code = '2297'`,
      );
      expect(survived.rows[0].n).toBe(1);
    } finally {
      await pool.query(`DELETE FROM courses WHERE term_id IN (SELECT id FROM terms WHERE code = '2297')`);
      await pool.query(`DELETE FROM terms WHERE code = '2297'`);
      await pool.query(`DELETE FROM departments WHERE code = 'ZTST'`);
      await pool.query(`DELETE FROM professors WHERE full_name = 'Ada Lovelace'`);
      await pool.end();
    }
  });
});
