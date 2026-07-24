import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { TermSummary } from '@csufsched/types';
import { api, ApiError } from './lib/api.ts';
import { resolveDrop } from './lib/dnd.ts';
import { useScheduleStore, placedSections } from './store.ts';
import { parseShareHash } from './lib/share.ts';
import { CalendarGrid, type GhostInfo } from './components/CalendarGrid.tsx';
import { CourseSearch } from './components/CourseSearch.tsx';
import { SolverPanel } from './components/SolverPanel.tsx';
import { ShareBar } from './components/ShareBar.tsx';
import type { DragData } from './components/SectionCard.tsx';

export default function App() {
  const [terms, setTerms] = useState<TermSummary[] | null>(null);
  const [dataFrom, setDataFrom] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragData | null>(null);
  const [ghost, setGhost] = useState<GhostInfo | null>(null);

  const termId = useScheduleStore((s) => s.termId);
  const busyBlocks = useScheduleStore((s) => s.busyBlocks);
  const placedSectionIds = useScheduleStore((s) => s.placedSectionIds);
  const catalog = useScheduleStore((s) => s.catalog);
  const apiStale = useScheduleStore((s) => s.apiStale);
  const setTerm = useScheduleStore((s) => s.setTerm);
  const placeSection = useScheduleStore((s) => s.placeSection);
  const setApiStale = useScheduleStore((s) => s.setApiStale);
  const hydrateShared = useScheduleStore((s) => s.hydrateShared);

  const placed = useMemo(
    () => placedSections({ catalog, placedSectionIds }).map((e) => e.section),
    [catalog, placedSectionIds],
  );

  useEffect(() => {
    const payload = parseShareHash(window.location.hash);
    void (async () => {
      let termList: TermSummary[] = [];
      try {
        const res = await api.terms();
        termList = res.data;
        setTerms(termList);
        setApiStale(res.stale);
      } catch {
        setTerms([]);
        setApiStale(true);
        return;
      }
      if (payload) {
        try {
          const term = termList.find((t) => t.id === payload.termId);
          const courses =
            payload.sectionIds.length > 0 ? (await api.sections(payload.sectionIds)).data : [];
          hydrateShared(
            payload.termId,
            term?.name ?? '',
            courses,
            payload.sectionIds,
            payload.busyBlocks,
          );
        } catch (err) {
          if (err instanceof ApiError) {
            setShareError('This schedule references an old semester.');
          }
        }
        history.replaceState(null, '', window.location.pathname);
      } else if (useScheduleStore.getState().termId === null && termList.length > 0) {
        setTerm(termList[0].id, termList[0].name);
      }
    })();
    void api
      .meta()
      .then((res) => setDataFrom(res.data.dataFrom))
      .catch(() => {});
  }, [hydrateShared, setApiStale, setTerm]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragStart(e: DragStartEvent) {
    setDrag((e.active.data.current as DragData | undefined) ?? null);
  }

  function onDragOver(e: DragOverEvent) {
    const data = e.active.data.current as DragData | undefined;
    if (data !== undefined && e.over?.id === 'calendar') {
      setGhost({
        section: data.section,
        conflict: resolveDrop(data.section, 'calendar', placed, busyBlocks) === 'reject',
      });
    } else {
      setGhost(null);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const data = e.active.data.current as DragData | undefined;
    const overId = e.over === null ? null : String(e.over.id);
    if (data !== undefined && resolveDrop(data.section, overId, placed, busyBlocks) === 'place') {
      placeSection(data.course, data.section.id);
    }
    setDrag(null);
    setGhost(null);
  }

  const fmtDataFrom = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (terms === null) {
    return <p className="p-8 text-gray-500">Loading…</p>;
  }
  if (terms.length === 0 && !apiStale) {
    return <p className="p-8 text-gray-500">No term data yet</p>;
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDrag(null);
        setGhost(null);
      }}
    >
      <div className="flex min-h-screen flex-col">
        {apiStale && (
          <div className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
            API unreachable — showing cached catalog.
          </div>
        )}
        {shareError && (
          <div className="bg-red-100 px-4 py-2 text-sm text-red-900">{shareError}</div>
        )}
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-lg font-semibold">CSUF Schedule Builder</h1>
          <div className="flex items-center gap-4">
            <select
              aria-label="Term"
              value={termId ?? ''}
              onChange={(e) => {
                const t = terms.find((x) => x.id === Number(e.target.value));
                if (t) setTerm(t.id, t.name);
              }}
              className="rounded border px-2 py-1 text-sm"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <ShareBar />
          </div>
        </header>
        <div className="flex flex-1">
          <aside className="w-80 space-y-6 overflow-y-auto border-r p-4">
            <CourseSearch />
            <SolverPanel />
          </aside>
          <main className="flex-1 overflow-x-auto p-4">
            <CalendarGrid ghost={ghost} />
          </main>
        </div>
        <footer className="border-t px-4 py-2 text-xs text-gray-500">
          {dataFrom ? `Data from ${fmtDataFrom(dataFrom)}` : 'Data freshness unknown'}
        </footer>
      </div>
      <DragOverlay>
        {drag && (
          <div className="rounded border bg-white p-2 text-sm shadow">
            {drag.course.deptCode} {drag.course.catalogNbr} · Sec {drag.section.sectionCode}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
