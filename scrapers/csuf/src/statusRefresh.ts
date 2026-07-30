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

  const updates = new Map<string, string>();
  const conflicted = new Set<string>();
  let incomplete = false;

  for (const subject of deps.subjects) {
    for (const career of deps.careers) {
      let found: SearchOutcome;
      try {
        found = await deps.search({ termCode: deps.termCode, subject, career });
      } catch (err) {
        incomplete = true;
        summary.searchErrors.push({
          subject,
          career,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (found.skipped.length > 0) incomplete = true;
      for (const s of found.skipped) {
        summary.resultRowsSkipped.push({ subject, career, rowIndex: s.rowIndex, error: s.error });
      }

      for (const { row } of found.rows) {
        const status = STATUS_MAP[row.enrollment_status];
        if (status === undefined) {
          incomplete = true;
          summary.rowsSkipped.push({
            classNbr: row.class_nbr,
            error: `unknown enrollment_status "${row.enrollment_status}"`,
          });
          continue;
        }
        if (conflicted.has(row.class_nbr)) continue;
        const previous = updates.get(row.class_nbr);
        if (previous !== undefined && previous !== status) {
          incomplete = true;
          conflicted.add(row.class_nbr);
          updates.delete(row.class_nbr);
          summary.rowsSkipped.push({
            classNbr: row.class_nbr,
            error: `conflicting statuses "${previous}" and "${status}"`,
          });
          continue;
        }
        updates.set(row.class_nbr, status);
      }
    }
  }

  summary.sectionsObserved = updates.size;
  const known = await deps.countExistingSections();
  if (incomplete) {
    summary.ok = false;
    return summary;
  }
  if (known > 0 && summary.sectionsObserved / known < deps.sanityMinRatio) {
    summary.ok = false;
    summary.abortedBySanityGate = true;
    return summary;
  }

  summary.sectionsUpdated = await deps.applyUpdates(
    [...updates].map(([classNbr, status]) => ({ classNbr, status })),
  );
  return summary;
}
