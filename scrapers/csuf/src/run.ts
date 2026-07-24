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
