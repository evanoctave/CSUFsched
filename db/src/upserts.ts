import type pg from 'pg';
import type { Day } from '@csufsched/types';

// A Pool or a PoolClient. The transactional swap needs every write on one client.
export interface Queryable {
  // `any` mirrors pg's own default row type; each caller narrows what it reads.
  query(text: string, values?: unknown[]): Promise<pg.QueryResult<any>>;
}

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

export async function upsertTerm(db: Queryable, t: TermRow): Promise<number> {
  const res = await db.query(
    `INSERT INTO terms (code, name) VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [t.code, t.name],
  );
  return res.rows[0].id;
}

export async function upsertDepartment(db: Queryable, d: DepartmentRow): Promise<number> {
  const res = await db.query(
    `INSERT INTO departments (code, name) VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [d.code, d.name],
  );
  return res.rows[0].id;
}

export async function upsertCourse(db: Queryable, c: CourseRow): Promise<number> {
  const res = await db.query(
    `INSERT INTO courses (term_id, dept_id, catalog_nbr, title, units, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (term_id, dept_id, catalog_nbr)
     DO UPDATE SET title = EXCLUDED.title, units = EXCLUDED.units, description = EXCLUDED.description
     RETURNING id`,
    [c.termId, c.deptId, c.catalogNbr, c.title, c.units, c.description],
  );
  return res.rows[0].id;
}

export async function upsertSection(db: Queryable, s: SectionRow): Promise<number> {
  const res = await db.query(
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
  db: Queryable,
  sectionId: number,
  meetings: MeetingRow[],
): Promise<void> {
  await db.query('DELETE FROM meetings WHERE section_id = $1', [sectionId]);
  for (const m of meetings) {
    await db.query(
      `INSERT INTO meetings (section_id, days, start_min, end_min, building, room)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sectionId, m.days.join(','), m.startMin, m.endMin, m.building, m.room],
    );
  }
}

export async function upsertProfessor(db: Queryable, p: ProfessorRow): Promise<number> {
  const res = await db.query(
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
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function countSectionsForTerm(db: Queryable, termId: number): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM sections s
     JOIN courses c ON c.id = s.course_id
     WHERE c.term_id = $1`,
    [termId],
  );
  return (res.rows[0] as { n: number }).n;
}

export async function deleteSectionsNotIn(
  db: Queryable,
  termId: number,
  keptSectionIds: number[],
): Promise<number> {
  const res = await db.query(
    `DELETE FROM sections s
     USING courses c
     WHERE c.id = s.course_id AND c.term_id = $1 AND NOT (s.id = ANY($2::int[]))`,
    [termId, keptSectionIds],
  );
  return res.rowCount ?? 0;
}

export async function deleteCoursesNotIn(
  db: Queryable,
  termId: number,
  keptCourseIds: number[],
): Promise<number> {
  const res = await db.query(
    `DELETE FROM courses WHERE term_id = $1 AND NOT (id = ANY($2::int[]))`,
    [termId, keptCourseIds],
  );
  return res.rowCount ?? 0;
}

export async function updateSectionStatuses(
  db: Queryable,
  termId: number,
  updates: Array<{ classNbr: string; status: string }>,
): Promise<number> {
  if (updates.length === 0) return 0;
  const res = await db.query(
    `UPDATE sections s
     SET enrollment_status = v.status
     FROM unnest($2::text[], $3::text[]) AS v(class_nbr, status),
          courses c
     WHERE c.id = s.course_id
       AND c.term_id = $1
       AND s.class_nbr = v.class_nbr
       AND s.enrollment_status IS DISTINCT FROM v.status`,
    [termId, updates.map((u) => u.classNbr), updates.map((u) => u.status)],
  );
  return res.rowCount ?? 0;
}
