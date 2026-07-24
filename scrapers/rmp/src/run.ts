import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, upsertProfessor, replaceProfTags } from '@csufsched/db';
import { mapTeacherNode } from './parse';
import { matchProfessor } from './match';
import type { RawTeacherNode, RmpTeacher } from './types';

export interface UpdateSummary {
  matched: number;
  ambiguous: Array<{ name: string; candidates: string[] }>;
  unmatched: string[];
  errors: Array<{ name: string; error: string }>;
}

export interface UpdateProfessorsOptions {
  csufNames: string[];
  teachers: RmpTeacher[];
  persistMatch: (csufName: string, teacher: RmpTeacher) => Promise<void>;
}

export async function updateProfessors(opts: UpdateProfessorsOptions): Promise<UpdateSummary> {
  const summary: UpdateSummary = { matched: 0, ambiguous: [], unmatched: [], errors: [] };

  for (const name of opts.csufNames) {
    const result = matchProfessor(name, opts.teachers);
    if (result.status === 'unmatched') {
      summary.unmatched.push(name);
      continue;
    }
    if (result.status === 'ambiguous') {
      summary.ambiguous.push({ name, candidates: result.candidates.map((c) => c.rmpId) });
      continue;
    }
    try {
      await opts.persistMatch(name, result.teacher);
      summary.matched += 1;
    } catch (err) {
      summary.errors.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

const SEARCH_QUERY = `
query TeacherSearch($schoolID: ID!, $cursor: String) {
  newSearch {
    teachers(query: { text: "", schoolID: $schoolID }, first: 100, after: $cursor) {
      edges { node {
        id legacyId firstName lastName
        avgRating avgDifficulty wouldTakeAgainPercent numRatings
        teacherRatingTags { tagName tagCount }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

interface SearchPage {
  data: {
    newSearch: {
      teachers: {
        edges: Array<{ node: RawTeacherNode }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  };
}

export async function fetchAllTeachers(
  schoolId: string,
  fetchFn: typeof fetch,
): Promise<RmpTeacher[]> {
  const teachers: RmpTeacher[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res = await fetchFn('https://www.ratemyprofessors.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic dGVzdDp0ZXN0',
      },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { schoolID: schoolId, cursor } }),
    });
    if (!res.ok) throw new Error(`RMP fetch failed: ${res.status}`);
    const page = (await res.json()) as SearchPage;
    const conn = page.data.newSearch.teachers;
    teachers.push(...conn.edges.map((e) => mapTeacherNode(e.node)));
    if (!conn.pageInfo.hasNextPage || conn.pageInfo.endCursor === null) break;
    cursor = conn.pageInfo.endCursor;
    await new Promise((resolve) => setTimeout(resolve, 1000)); // polite pacing
  }
  return teachers;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const databaseUrl = process.env.DATABASE_URL;
  const schoolId = process.env.RMP_SCHOOL_ID;
  if (!databaseUrl || !schoolId) {
    console.error('Required env: DATABASE_URL, RMP_SCHOOL_ID');
    process.exit(1);
  }

  const pool = createPool(databaseUrl);

  const run = async (): Promise<void> => {
    const namesRes = await pool.query('SELECT full_name FROM professors ORDER BY full_name');
    const csufNames: string[] = namesRes.rows.map((r) => r.full_name as string);
    const teachers = await fetchAllTeachers(schoolId, fetch);

    const persistMatch = async (csufName: string, teacher: RmpTeacher): Promise<void> => {
      const profId = await upsertProfessor(pool, {
        fullName: csufName,
        rmpId: teacher.rmpId,
        rating: teacher.rating,
        difficulty: teacher.difficulty,
        wouldTakeAgainPct: teacher.wouldTakeAgainPct,
        numRatings: teacher.numRatings,
        rmpUrl: teacher.rmpUrl,
      });
      await replaceProfTags(pool, profId, teacher.tags);
    };

    const summary = await updateProfessors({ csufNames, teachers, persistMatch });

    const reportPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'reports',
      `ambiguous-${new Date().toISOString().slice(0, 10)}.json`,
    );
    if (summary.ambiguous.length > 0) {
      await writeFile(reportPath, JSON.stringify(summary.ambiguous, null, 2));
      console.log(`Ambiguous matches written to ${reportPath}`);
    }
    console.log(JSON.stringify({ ...summary, ambiguous: summary.ambiguous.length }, null, 2));
  };

  run()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
