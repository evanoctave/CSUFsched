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

  if (termId === null) return <p className="p-2 text-sm text-gray-500">Pick a term to start.</p>;

  return (
    <div className="space-y-2 p-2">
      <label className="block text-xs font-medium text-gray-600">
        Department
        <select
          aria-label="Department"
          className="mt-1 w-full rounded border p-1 text-sm"
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
        className="w-full rounded border p-1 text-sm"
        placeholder="Search courses"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {loadError && <p className="text-xs text-red-600">Couldn't load catalog data.</p>}
      {dept !== '' && filtered.length === 0 && !loadError && (
        <p className="text-xs text-gray-500">No courses match.</p>
      )}
      <ul className="space-y-1">
        {filtered.map((course) => (
          <li key={course.id} className="rounded border bg-white">
            <div className="flex items-center justify-between p-2">
              <button
                type="button"
                className="text-left text-sm"
                onClick={() => setExpanded(expanded === course.id ? null : course.id)}
              >
                <span className="font-semibold">{`${course.deptCode} ${course.catalogNbr}`}</span>
                <span className="block text-xs text-gray-600">{course.title}</span>
                <span className="text-xs text-gray-400">{`${course.units} units`}</span>
              </button>
              <button
                type="button"
                className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
                onClick={() => addWantedCourse(course)}
              >
                + Solver
              </button>
            </div>
            {expanded === course.id && (
              <div className="space-y-1 border-t p-2">
                {course.sections.length === 0 && (
                  <p className="text-xs text-gray-500">No sections listed.</p>
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
