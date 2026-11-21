import { useState } from 'react';
import { solve } from '@csufsched/solver';
import type { CourseWithSections, Day, SolverResult } from '@csufsched/types';
import { DAY_LABELS, DAY_ORDER, GRID_START_MIN, minToLabel } from '../lib/time.ts';
import { findSection, useScheduleStore } from '../store.ts';
import { courseColor } from '../lib/colors.ts';

const START_OPTIONS = [420, 480, 540, 600, 660]; // 7am–11am
const END_OPTIONS = [720, 840, 960, 1080, 1200, 1320]; // 12pm–10pm

function MiniCal({
  sectionIds,
  catalog,
}: {
  sectionIds: number[];
  catalog: Record<number, CourseWithSections>;
}) {
  const entries = sectionIds
    .map((id) => findSection(catalog, id))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return (
    <span className="grid w-28 shrink-0 grid-cols-7 gap-px overflow-hidden rounded-md" aria-hidden="true">
      {DAY_ORDER.map((day) => (
        <span key={day} className="relative block h-[90px] bg-paper">
          {entries.flatMap(({ course, section }) =>
            section.meetings
              .filter((m) => m.days.includes(day))
              .map((m, i) => (
                <span
                  key={`${section.id}-${i}`}
                  className={`absolute inset-x-0 block rounded-sm ${courseColor(course.id).dot}`}
                  style={{
                    top: `${(m.startMin - GRID_START_MIN) / 10}px`,
                    height: `${(m.endMin - m.startMin) / 10}px`,
                  }}
                />
              )),
          )}
        </span>
      ))}
    </span>
  );
}

export function SolverPanel() {
  const catalog = useScheduleStore((s) => s.catalog);
  const wantedCourseIds = useScheduleStore((s) => s.wantedCourseIds);
  const removeWantedCourse = useScheduleStore((s) => s.removeWantedCourse);
  const busyBlocks = useScheduleStore((s) => s.busyBlocks);
  const placedSectionIds = useScheduleStore((s) => s.placedSectionIds);
  const prefs = useScheduleStore((s) => s.prefs);
  const setPrefs = useScheduleStore((s) => s.setPrefs);
  const loadCandidate = useScheduleStore((s) => s.loadCandidate);
  const [result, setResult] = useState<SolverResult | null>(null);

  const wanted = wantedCourseIds
    .map((id) => catalog[id])
    .filter((c): c is CourseWithSections => c !== undefined);
  const units = wanted.reduce((sum, c) => sum + c.units, 0);

  function toggleDay(day: Day) {
    setPrefs({
      avoidDays: prefs.avoidDays.includes(day)
        ? prefs.avoidDays.filter((d) => d !== day)
        : [...prefs.avoidDays, day],
    });
  }

  function generate() {
    setResult(
      solve({
        courses: wanted,
        busyBlocks,
        lockedSectionIds: placedSectionIds,
        prefs,
      }),
    );
  }

  return (
    <div className="space-y-4 border-t p-5">
      <h2 className="font-display text-base font-semibold tracking-tight">Schedule generator</h2>

      <ul className="space-y-1.5">
        {wanted.map((c) => (
          <li
            key={c.id}
            className="flex animate-reveal items-center gap-2 rounded-lg bg-paper px-2.5 py-1.5 text-xs font-medium"
          >
            <span aria-hidden="true" className={`size-2 rounded-full ${courseColor(c.id).dot}`} />
            <span className="flex-1">{`${c.deptCode} ${c.catalogNbr} (${c.units}u)`}</span>
            <button
              type="button"
              className="grid size-5 place-items-center rounded text-sm leading-none text-muted transition hover:bg-ink/10 hover:text-ink"
              aria-label={`Remove ${c.deptCode} ${c.catalogNbr}`}
              onClick={() => removeWantedCourse(c.id)}
            >
              ×
            </button>
          </li>
        ))}
        {wanted.length === 0 && (
          <li className="text-xs text-muted">Add courses with "+ Solver".</li>
        )}
      </ul>

      <p className="text-xs font-semibold">{`${units} units`}</p>
      {units > prefs.maxUnits && (
        <p className="animate-reveal rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {`Over ${prefs.maxUnits} units — allowed, but requires an overload pardon.`}
        </p>
      )}

      <fieldset className="text-xs">
        <legend className="mb-1.5 font-medium text-muted">Avoid days</legend>
        <div className="flex flex-wrap gap-1">
          {DAY_ORDER.map((day) => (
            <label
              key={day}
              className="cursor-pointer rounded-full border px-2 py-1 font-medium transition select-none hover:border-ink/40 has-checked:border-ink has-checked:bg-ink has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-titan"
            >
              <input
                type="checkbox"
                className="sr-only"
                aria-label={DAY_LABELS[day]}
                checked={prefs.avoidDays.includes(day)}
                onChange={() => toggleDay(day)}
              />
              {DAY_LABELS[day]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3 text-xs font-medium text-muted">
        <label>
          Earliest start
          <select
            className="field mt-1"
            value={prefs.earliestStart ?? ''}
            onChange={(e) =>
              setPrefs({
                earliestStart: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          >
            <option value="">Any</option>
            {START_OPTIONS.map((m) => (
              <option key={m} value={m}>{minToLabel(m)}</option>
            ))}
          </select>
        </label>
        <label>
          Latest end
          <select
            className="field mt-1"
            value={prefs.latestEnd ?? ''}
            onChange={(e) =>
              setPrefs({ latestEnd: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          >
            <option value="">Any</option>
            {END_OPTIONS.map((m) => (
              <option key={m} value={m}>{minToLabel(m)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs font-medium text-muted">
        <label>
          {`Prof rating weight (${prefs.weightProfRating.toFixed(1)})`}
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            className="w-full"
            value={prefs.weightProfRating}
            onChange={(e) => setPrefs({ weightProfRating: Number(e.target.value) })}
          />
        </label>
        <label>
          {`Minimize gaps weight (${prefs.weightMinimizeGaps.toFixed(1)})`}
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            className="w-full"
            value={prefs.weightMinimizeGaps}
            onChange={(e) => setPrefs({ weightMinimizeGaps: Number(e.target.value) })}
          />
        </label>
      </div>

      <button
        type="button"
        className="w-full rounded-lg bg-titan py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:brightness-105 active:scale-[0.98] disabled:bg-line disabled:text-muted disabled:shadow-none disabled:active:scale-100"
        disabled={wanted.length === 0}
        onClick={generate}
      >
        Generate schedules
      </button>

      {result !== null && result.candidates.length > 0 && (
        <ul className="space-y-2">
          {result.candidates.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                data-testid="candidate"
                className="flex w-full animate-reveal items-center gap-3 rounded-xl border bg-white p-2.5 text-left text-xs transition hover:-translate-y-px hover:border-ink/40 hover:shadow-md hover:shadow-ink/10 active:translate-y-0"
                onClick={() => loadCandidate(c.sectionIds)}
              >
                <MiniCal sectionIds={c.sectionIds} catalog={catalog} />
                <span>{c.explanation}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {result !== null && result.candidates.length === 0 && (
        <div className="animate-reveal space-y-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          <p className="font-semibold">No conflict-free schedule found.</p>
          {result.eliminations.map((e) => (
            <p key={e.courseId}>
              {`${e.courseLabel}: all sections eliminated (${e.reasons.join(', ')})`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
