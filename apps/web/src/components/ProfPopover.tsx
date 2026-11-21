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
    <span
      className="relative"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={() => setOpen(false)}
    >
      <span className="cursor-help underline decoration-muted/50 decoration-dotted underline-offset-2">{label}</span>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1.5 block w-60 animate-reveal space-y-1 rounded-lg border bg-white p-3 text-xs leading-relaxed text-ink shadow-xl shadow-ink/15"
        >
          {detail === null ? (
            'Loading…'
          ) : (
            <>
              <span className="block font-display text-sm font-semibold">{detail.fullName}</span>
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
                <span className="block text-muted">{detail.numRatings} ratings</span>
              )}
              {detail.tags.map((t) => (
                <span key={t.tag} className="mr-1 mt-1 inline-block rounded-full bg-paper px-2 py-0.5">
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
