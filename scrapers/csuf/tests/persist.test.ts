import { describe, it, expect } from 'vitest';
import { createPool } from '@csufsched/db';
import { persistTerm } from '../src/persist';
import type { ScrapedCourse } from '../src/types';

const TEST_URL = process.env.TEST_DATABASE_URL;

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
  it('keeps section ids stable across runs, replaces meetings, and prunes vanished rows', async () => {
    const pool = createPool(TEST_URL!);
    try {
      const first = await persistTerm(pool, {
        termCode: '2299',
        termName: 'Test Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [course(), course({ catalogNbr: '102', title: 'Second' })],
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

  it('leaves the previous catalog untouched when a write fails mid-run', async () => {
    const pool = createPool(TEST_URL!);
    try {
      await persistTerm(pool, {
        termCode: '2297',
        termName: 'Rollback Term',
        departmentNames: new Map([['ZTST', 'Test Dept']]),
        courses: [course()],
      });

      // title is NOT NULL, so this write fails inside the transaction
      const bad = course({ catalogNbr: '103', title: null as unknown as string });
      await expect(
        persistTerm(pool, {
          termCode: '2297',
          termName: 'Rollback Term',
          departmentNames: new Map([['ZTST', 'Test Dept']]),
          courses: [course(), bad],
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
