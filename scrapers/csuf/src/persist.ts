import {
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  upsertProfessor,
  replaceMeetings,
  deleteCoursesNotIn,
  deleteSectionsNotIn,
} from '@csufsched/db';
import type { Pool } from '@csufsched/db';
import type { PersistInput, PersistResult } from './types.ts';

// One transaction for the whole term: readers on other connections keep seeing
// yesterday's catalog until commit, and section ids survive so Plan 4's share
// links stay valid.
export async function persistTerm(pool: Pool, input: PersistInput): Promise<PersistResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const termId = await upsertTerm(client, { code: input.termCode, name: input.termName });

    const deptIds = new Map<string, number>();
    const professorIds = new Map<string, number>();
    const keptCourseIds: number[] = [];
    const keptSectionIds: number[] = [];

    for (const course of input.courses) {
      let deptId = deptIds.get(course.deptCode);
      if (deptId === undefined) {
        deptId = await upsertDepartment(client, {
          code: course.deptCode,
          name: input.departmentNames.get(course.deptCode) ?? course.deptCode,
        });
        deptIds.set(course.deptCode, deptId);
      }

      const courseId = await upsertCourse(client, {
        termId,
        deptId,
        catalogNbr: course.catalogNbr,
        title: course.title,
        units: course.units,
        description: null,
      });
      keptCourseIds.push(courseId);

      for (const s of course.sections) {
        let instructorId: number | null = null;
        if (s.instructorName !== null) {
          const cached = professorIds.get(s.instructorName);
          instructorId = cached ?? (await upsertProfessor(client, { fullName: s.instructorName }));
          professorIds.set(s.instructorName, instructorId);
        }
        const sectionId = await upsertSection(client, {
          courseId,
          classNbr: s.classNbr,
          sectionCode: s.sectionCode,
          instructorId,
          mode: s.mode,
          enrollmentStatus: s.enrollmentStatus,
        });
        keptSectionIds.push(sectionId);
        await replaceMeetings(client, sectionId, s.meetings);
      }
    }

    const sectionsDeleted = await deleteSectionsNotIn(client, termId, keptSectionIds);
    const coursesDeleted = await deleteCoursesNotIn(client, termId, keptCourseIds);

    await client.query('COMMIT');
    return {
      termId,
      coursesUpserted: keptCourseIds.length,
      sectionsUpserted: keptSectionIds.length,
      coursesDeleted,
      sectionsDeleted,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
