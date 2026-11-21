import { useEffect, useState } from 'react';
import type { CourseWithSections, DepartmentSummary } from '@csufsched/types';
import { api } from '../lib/api.ts';
import { useScheduleStore } from '../store.ts';
import { SectionCard } from './SectionCard.tsx';

export function CourseSearch() {
  const termId = useScheduleStore((s) => s.termId);
  const setApiStale = useScheduleStore((s) => s.setApiStale);
  const addWantedCourse = useScheduleStore((s) => s.addWantedCourse);
  const [depts, setDepts] = useState<DepartmentSummary[]>([]);
  const [dept, setDept] = useState('');
  const [courses, setCourses] = useState<CourseWithSections[]>([]);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (termId === null) return;
    api
      .departments(termId)
      .then((r) => {
        setDepts(r.data);
        if (r.stale) setApiStale(true);
      })
      .catch(() => setLoadError(true));
  }, [termId, setApiStale]);

  useEffect(() => {
    if (termId === null || dept === '') return;
    setCourses([]);
    api
      .courses(termId, dept)
      .then((r) => {
        setCourses(r.data);
        if (r.stale) setApiStale(true);
      })
      .catch(() => setLoadError(true));
  }, [termId, dept, setApiStale]);

  const needle = q.trim().toLowerCase();
  const filtered =
    needle === ''
      ? courses
      : courses.filter(
          (c) =>
            c.catalogNbr.toLowerCase().startsWith(needle) ||
            c.title.toLowerCase().includes(needle),
        );

  if (termId === null) return <p className="p-5 text-sm text-muted">Pick a term to start.</p>;

  return (
    <div className="space-y-3 p-5">
      <h2 className="font-display text-base font-semibold tracking-tight">Find courses</h2>
      <label className="block text-xs font-medium text-muted">
        Department
        <select
          aria-label="Department"
          className="field mt-1"
          value={dept}
          onChange={(e) => setDept(e.target.value)}
        >
          <option value="">Select a department…</option>
          {depts.map((d) => (
            <option key={d.id} value={d.code}>{`${d.code} — ${d.name}`}</option>
          ))}
        </select>
      </label>
      <input
        type="search"
        aria-label="Search courses"
        className="field"
        placeholder="Search courses"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {loadError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">Couldn't load catalog data.</p>}
      {dept !== '' && filtered.length === 0 && !loadError && (
        <p className="text-xs text-muted">No courses match.</p>
      )}
      <ul className="space-y-2">
        {filtered.map((course) => (
          <li
            key={course.id}
            className={`rounded-xl border transition-colors ${
              expanded === course.id ? 'border-ink/30 bg-paper/60' : 'bg-white hover:border-ink/30'
            }`}
          >
            <div className="flex items-center justify-between gap-2 p-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left text-sm"
                aria-expanded={expanded === course.id}
                onClick={() => setExpanded(expanded === course.id ? null : course.id)}
              >
                <span className="font-display font-semibold">{`${course.deptCode} ${course.catalogNbr}`}</span>
                <span className="block truncate text-xs text-muted">{course.title}</span>
                <span className="text-xs text-muted/70">{`${course.units} units`}</span>
              </button>
              <button
                type="button"
                className="shrink-0 rounded-full border border-ink/15 px-2.5 py-1 text-xs font-medium transition hover:border-ink hover:bg-ink hover:text-white active:scale-95"
                onClick={() => addWantedCourse(course)}
              >
                + Solver
              </button>
            </div>
            {expanded === course.id && (
              <div className="animate-reveal space-y-1.5 border-t p-2">
                {course.sections.length === 0 && (
                  <p className="p-1 text-xs text-muted">No sections listed.</p>
                )}
                {course.sections.map((section) => (
                  <SectionCard key={section.id} course={course} section={section} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
