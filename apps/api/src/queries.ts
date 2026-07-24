import type pg from 'pg';
import type {
  CourseWithSections,
  DepartmentSummary,
  ProfessorDetail,
  TermSummary,
} from '@csufsched/types';
import {
  assembleCourses,
  type CourseQueryRow,
  type SectionQueryRow,
  type MeetingQueryRow,
  type TagQueryRow,
} from './assemble.ts';

export interface ApiQueries {
  listTerms(): Promise<TermSummary[]>;
  termExists(termId: number): Promise<boolean>;
  listDepartments(termId: number): Promise<DepartmentSummary[]>;
  listCourses(termId: number, deptCode: string, q: string | null): Promise<CourseWithSections[]>;
  getProfessorDetail(id: number): Promise<ProfessorDetail | null>;
  listSectionsByIds(ids: number[]): Promise<CourseWithSections[] | null>;
}

const SECTION_SELECT = `
  SELECT s.id, s.course_id, s.class_nbr, s.section_code, s.mode, s.enrollment_status,
         p.id AS professor_id, p.full_name AS professor_full_name,
         p.rating AS professor_rating, p.difficulty AS professor_difficulty,
         p.would_take_again_pct AS professor_would_take_again_pct
  FROM sections s
  LEFT JOIN professors p ON p.id = s.instructor_id`;

async function fetchMeetingsAndTags(
  pool: pg.Pool,
  sectionRows: SectionQueryRow[],
): Promise<{ meetingRows: MeetingQueryRow[]; tagRows: TagQueryRow[] }> {
  const sectionIds = sectionRows.map((s) => s.id);
  const profIds = [
    ...new Set(sectionRows.map((s) => s.professor_id).filter((id): id is number => id !== null)),
  ];
  const meetingRows =
    sectionIds.length === 0
      ? []
      : ((
          await pool.query(
            `SELECT section_id, days, start_min, end_min, building, room
             FROM meetings WHERE section_id = ANY($1) ORDER BY section_id, start_min`,
            [sectionIds],
          )
        ).rows as MeetingQueryRow[]);
  const tagRows =
    profIds.length === 0
      ? []
      : ((
          await pool.query(
            `SELECT professor_id, tag, count FROM prof_tags WHERE professor_id = ANY($1)`,
            [profIds],
          )
        ).rows as TagQueryRow[]);
  return { meetingRows, tagRows };
}

export function makeQueries(pool: pg.Pool): ApiQueries {
  return {
    async listTerms() {
      const res = await pool.query('SELECT id, code, name FROM terms ORDER BY code');
      return res.rows as TermSummary[];
    },

    async termExists(termId) {
      const res = await pool.query('SELECT 1 FROM terms WHERE id = $1', [termId]);
      return (res.rowCount ?? 0) > 0;
    },

    async listDepartments(termId) {
      const res = await pool.query(
        `SELECT DISTINCT d.id, d.code, d.name
         FROM departments d
         JOIN courses c ON c.dept_id = d.id
         WHERE c.term_id = $1
         ORDER BY d.code`,
        [termId],
      );
      return res.rows as DepartmentSummary[];
    },

    async listCourses(termId, deptCode, q) {
      const courseRes = await pool.query(
        `SELECT c.id, d.code AS dept_code, c.catalog_nbr, c.title, c.units
         FROM courses c
         JOIN departments d ON d.id = c.dept_id
         WHERE c.term_id = $1 AND d.code = $2
           AND ($3::text IS NULL OR c.catalog_nbr ILIKE $3 || '%' OR c.title ILIKE '%' || $3 || '%')
         ORDER BY c.catalog_nbr`,
        [termId, deptCode, q],
      );
      const courseRows = courseRes.rows as CourseQueryRow[];
      if (courseRows.length === 0) return [];
      const sectionRes = await pool.query(
        `${SECTION_SELECT} WHERE s.course_id = ANY($1) ORDER BY s.course_id, s.section_code`,
        [courseRows.map((c) => c.id)],
      );
      const sectionRows = sectionRes.rows as SectionQueryRow[];
      const { meetingRows, tagRows } = await fetchMeetingsAndTags(pool, sectionRows);
      return assembleCourses(courseRows, sectionRows, meetingRows, tagRows);
    },

    async getProfessorDetail(id) {
      const res = await pool.query(
        `SELECT id, full_name, rating, difficulty, would_take_again_pct, num_ratings, rmp_url
         FROM professors WHERE id = $1`,
        [id],
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0] as {
        id: number;
        full_name: string;
        rating: number | null;
        difficulty: number | null;
        would_take_again_pct: number | null;
        num_ratings: number | null;
        rmp_url: string | null;
      };
      const tags = await pool.query(
        'SELECT tag, count FROM prof_tags WHERE professor_id = $1 ORDER BY count DESC, tag',
        [id],
      );
      return {
        id: row.id,
        fullName: row.full_name,
        rating: row.rating,
        difficulty: row.difficulty,
        wouldTakeAgainPct: row.would_take_again_pct,
        numRatings: row.num_ratings,
        rmpUrl: row.rmp_url,
        tags: tags.rows as Array<{ tag: string; count: number }>,
      };
    },

    async listSectionsByIds(ids) {
      if (ids.length === 0) return [];
      const sectionRes = await pool.query(`${SECTION_SELECT} WHERE s.id = ANY($1)`, [ids]);
      const sectionRows = sectionRes.rows as SectionQueryRow[];
      if (sectionRows.length !== ids.length) return null;
      const courseIds = [...new Set(sectionRows.map((s) => s.course_id))];
      const courseRes = await pool.query(
        `SELECT c.id, d.code AS dept_code, c.catalog_nbr, c.title, c.units
         FROM courses c
         JOIN departments d ON d.id = c.dept_id
         WHERE c.id = ANY($1)
         ORDER BY d.code, c.catalog_nbr`,
        [courseIds],
      );
      const { meetingRows, tagRows } = await fetchMeetingsAndTags(pool, sectionRows);
      return assembleCourses(courseRes.rows as CourseQueryRow[], sectionRows, meetingRows, tagRows);
    },
  };
}
