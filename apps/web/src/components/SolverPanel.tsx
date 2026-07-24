import { useState } from 'react';
import { solve } from '@csufsched/solver';
import type { CourseWithSections, Day, SolverResult } from '@csufsched/types';
import { DAY_LABELS, DAY_ORDER, GRID_START_MIN, minToLabel } from '../lib/time.ts';
import { findSection, useScheduleStore } from '../store.ts';

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
    <span className="grid w-28 grid-cols-7 gap-px" aria-hidden="true">
      {DAY_ORDER.map((day) => (
        <span key={day} className="relative block h-[90px] bg-gray-100">
          {entries.flatMap(({ section }) =>
            section.meetings
              .filter((m) => m.days.includes(day))
              .map((m, i) => (
                <span
                  key={`${section.id}-${i}`}
                  className="absolute inset-x-0 block rounded-sm bg-blue-400"
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
    <div className="space-y-3 border-t p-2">
      <h2 className="text-sm font-semibold">Schedule generator</h2>

      <ul className="space-y-1">
        {wanted.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-xs">
            <span>{`${c.deptCode} ${c.catalogNbr} (${c.units}u)`}</span>
            <button
              type="button"
              aria-label={`Remove ${c.deptCode} ${c.catalogNbr}`}
              onClick={() => removeWantedCourse(c.id)}
            >
              ×
            </button>
          </li>
        ))}
        {wanted.length === 0 && (
          <li className="text-xs text-gray-500">Add courses with "+ Solver".</li>
        )}
      </ul>

      <p className="text-xs font-medium">{`${units} units`}</p>
      {units > prefs.maxUnits && (
        <p className="rounded bg-amber-100 p-1 text-xs text-amber-800">
          {`Over ${prefs.maxUnits} units — allowed, but requires an overload pardon.`}
        </p>
      )}

      <fieldset className="text-xs">
        <legend className="font-medium">Avoid days</legend>
        <div className="flex flex-wrap gap-2">
          {DAY_ORDER.map((day) => (
            <label key={day} className="flex items-center gap-1">
              <input
                type="checkbox"
                aria-label={DAY_LABELS[day]}
                checked={prefs.avoidDays.includes(day)}
                onChange={() => toggleDay(day)}
              />
              {DAY_LABELS[day]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>
          Earliest start
          <select
            className="mt-1 w-full rounded border p-1"
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
            className="mt-1 w-full rounded border p-1"
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

      <div className="grid grid-cols-2 gap-2 text-xs">
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
        className="w-full rounded bg-blue-600 py-1 text-sm text-white disabled:bg-gray-300"
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
                className="flex w-full items-center gap-2 rounded border bg-white p-2 text-left text-xs hover:border-blue-400"
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
        <div className="space-y-1 text-xs text-red-700">
          <p>No conflict-free schedule found.</p>
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
