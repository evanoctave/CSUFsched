import { parseClassRows } from './parse.ts';
import type { SearchOutcome } from './searchPage.ts';
import { selectTerms } from './validation.ts';
import type {
  Catalog,
  PersistInput,
  PersistResult,
  ResultRow,
  SearchCriteria,
} from './types.ts';

export interface FullScrapeDeps {
  catalog: Catalog;
  search: (criteria: SearchCriteria) => Promise<SearchOutcome>;
  fetchUnits: (rowIndex: number) => Promise<string>;
  countExistingSections: (termCode: string) => Promise<number>;
  persist: (input: PersistInput) => Promise<PersistResult>;
  sanityMinRatio: number;
  termCodes?: string[];
}

export interface TermSummary {
  termCode: string;
  sectionsParsed: number;
  sectionsBefore: number;
  abortedByErrors: boolean;
  abortedBySanityGate: boolean;
  persisted: PersistResult | null;
}

export interface ScrapeSummary {
  ok: boolean;
  searchesRun: number;
  sectionsParsed: number;
  terms: TermSummary[];
  searchErrors: Array<{ term: string; subject: string; career: string; error: string }>;
  detailErrors: Array<{ course: string; error: string }>;
  rowsSkipped: Array<{ row: unknown; error: string }>;
  resultRowsSkipped: Array<{
    term: string;
    subject: string;
    career: string;
    rowIndex: number;
    error: string;
  }>;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runFullScrape(deps: FullScrapeDeps): Promise<ScrapeSummary> {
  const summary: ScrapeSummary = {
    ok: true,
    searchesRun: 0,
    sectionsParsed: 0,
    terms: [],
    searchErrors: [],
    detailErrors: [],
    rowsSkipped: [],
    resultRowsSkipped: [],
  };

  const terms = selectTerms(deps.catalog, deps.termCodes);
  const departmentNames = new Map(deps.catalog.subjects.map((s) => [s.code, s.name]));

  for (const term of terms) {
    let incomplete = false;
    // Units are a course attribute, so one detail fetch serves every section and
    // every career that offers the course.
    const unitsByCourse = new Map<string, string>();
    const rows: ResultRow[] = [];

    for (const subject of deps.catalog.subjects) {
      for (const career of deps.catalog.careers) {
        const criteria = { termCode: term.code, subject: subject.code, career: career.code };
        let found: SearchOutcome;
        try {
          found = await deps.search(criteria);
        } catch (err) {
          incomplete = true;
          summary.searchErrors.push({
            term: term.code,
            subject: subject.code,
            career: career.code,
            error: message(err),
          });
          continue;
        }
        summary.searchesRun += 1;
        if (found.skipped.length > 0) incomplete = true;
        for (const s of found.skipped) {
          summary.resultRowsSkipped.push({
            term: term.code,
            subject: subject.code,
            career: career.code,
            rowIndex: s.rowIndex,
            error: s.error,
          });
        }

        for (const result of found.rows) {
          const key = `${result.row.subject} ${result.row.catalog_nbr}`;
          if (!unitsByCourse.has(key)) {
            try {
              unitsByCourse.set(key, await deps.fetchUnits(result.rowIndex));
            } catch (err) {
              incomplete = true;
              summary.detailErrors.push({ course: key, error: message(err) });
              unitsByCourse.set(key, '');
            }
          }
          rows.push(result);
        }
      }
    }

    const withUnits = rows
      .map((r) => ({ ...r.row, units: unitsByCourse.get(`${r.row.subject} ${r.row.catalog_nbr}`) ?? '' }))
      .filter((r) => r.units !== '');
    const { courses, skipped } = parseClassRows(withUnits);
    summary.rowsSkipped.push(...skipped);
    if (skipped.length > 0) incomplete = true;

    const sectionsParsed = courses.reduce((n, c) => n + c.sections.length, 0);
    summary.sectionsParsed += sectionsParsed;
    const sectionsBefore = await deps.countExistingSections(term.code);

    if (incomplete) {
      summary.ok = false;
      summary.terms.push({
        termCode: term.code,
        sectionsParsed,
        sectionsBefore,
        abortedByErrors: true,
        abortedBySanityGate: false,
        persisted: null,
      });
      continue;
    }

    const gatePassed = sectionsBefore === 0 || sectionsParsed / sectionsBefore >= deps.sanityMinRatio;

    if (!gatePassed) {
      summary.ok = false;
      summary.terms.push({
        termCode: term.code,
        sectionsParsed,
        sectionsBefore,
        abortedByErrors: false,
        abortedBySanityGate: true,
        persisted: null,
      });
      continue;
    }

    const persisted = await deps.persist({
      termCode: term.code,
      termName: term.name,
      departmentNames,
      courses,
    });
    summary.terms.push({
      termCode: term.code,
      sectionsParsed,
      sectionsBefore,
      abortedByErrors: false,
      abortedBySanityGate: false,
      persisted,
    });
  }

  return summary;
}
