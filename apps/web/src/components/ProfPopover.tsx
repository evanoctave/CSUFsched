import { useState } from 'react';
import type { ProfessorDetail, ProfessorSummary } from '@csufsched/types';
import { api } from '../lib/api.ts';

export function ProfPopover({ prof }: { prof: ProfessorSummary }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ProfessorDetail | null>(null);

  function show() {
    setOpen(true);
    if (detail === null) {
      api
        .professor(prof.id)
        .then((r) => setDetail(r.data))
        .catch(() => {});
    }
  }

  const label =
    prof.rating !== null ? `${prof.fullName} ★${prof.rating.toFixed(1)}` : prof.fullName;

  return (
    <span className="relative" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <span className="cursor-help underline decoration-dotted">{label}</span>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-10 mt-1 block w-56 rounded border bg-white p-2 text-xs shadow-lg"
        >
          {detail === null ? (
            'Loading…'
          ) : (
            <>
              <span className="block font-semibold">{detail.fullName}</span>
              <span className="block">
                ★ {detail.rating?.toFixed(1) ?? '—'} · Difficulty{' '}
                {detail.difficulty?.toFixed(1) ?? '—'}
              </span>
              <span className="block">
                {detail.wouldTakeAgainPct !== null
                  ? `${detail.wouldTakeAgainPct}% would take again`
                  : 'No RMP match'}
              </span>
              {detail.numRatings !== null && (
                <span className="block text-gray-500">{detail.numRatings} ratings</span>
              )}
              {detail.tags.map((t) => (
                <span key={t.tag} className="mr-1 inline-block rounded bg-gray-100 px-1">
                  {`${t.tag} (${t.count})`}
                </span>
              ))}
            </>
          )}
        </span>
      )}
    </span>
  );
}
