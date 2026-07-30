import type { SearchOutcome } from './searchPage.ts';
import type { SearchCriteria } from './types.ts';

const STATUS_MAP: Record<string, string> = { O: 'open', C: 'closed', W: 'waitlist' };

export interface StatusRefreshDeps {
  termCode: string;
  subjects: string[];
  careers: string[];
  search: (criteria: SearchCriteria) => Promise<SearchOutcome>;
  countExistingSections: () => Promise<number>;
  applyUpdates: (updates: Array<{ classNbr: string; status: string }>) => Promise<number>;
  sanityMinRatio: number;
}

export interface StatusRefreshSummary {
  ok: boolean;
  sectionsObserved: number;
  sectionsUpdated: number;
  abortedBySanityGate: boolean;
  searchErrors: Array<{ subject: string; career: string; error: string }>;
  rowsSkipped: Array<{ classNbr: string; error: string }>;
  resultRowsSkipped: Array<{ subject: string; career: string; rowIndex: number; error: string }>;
}

export async function refreshStatuses(deps: StatusRefreshDeps): Promise<StatusRefreshSummary> {
  const summary: StatusRefreshSummary = {
    ok: true,
    sectionsObserved: 0,
    sectionsUpdated: 0,
    abortedBySanityGate: false,
    searchErrors: [],
    rowsSkipped: [],
    resultRowsSkipped: [],
  };

  const updates: Array<{ classNbr: string; status: string }> = [];

  for (const subject of deps.subjects) {
    for (const career of deps.careers) {
      let found: SearchOutcome;
      try {
        found = await deps.search({ termCode: deps.termCode, subject, career });
      } catch (err) {
        summary.searchErrors.push({
          subject,
          career,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      for (const s of found.skipped) {
        summary.resultRowsSkipped.push({ subject, career, rowIndex: s.rowIndex, error: s.error });
      }

      for (const { row } of found.rows) {
        summary.sectionsObserved += 1;
        const status = STATUS_MAP[row.enrollment_status];
        if (status === undefined) {
          summary.rowsSkipped.push({
            classNbr: row.class_nbr,
            error: `unknown enrollment_status "${row.enrollment_status}"`,
          });
          continue;
        }
        updates.push({ classNbr: row.class_nbr, status });
      }
    }
  }

  const known = await deps.countExistingSections();
  if (known > 0 && summary.sectionsObserved / known < deps.sanityMinRatio) {
    summary.ok = false;
    summary.abortedBySanityGate = true;
    return summary;
  }

  summary.sectionsUpdated = await deps.applyUpdates(updates);
  return summary;
}
