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
    return <p className="grid min-h-dvh animate-pulse place-items-center text-sm text-muted">Loading…</p>;
  }
  if (terms.length === 0 && !apiStale) {
    return <p className="grid min-h-dvh place-items-center text-sm text-muted">No term data yet</p>;
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
      <div className="flex min-h-dvh flex-col lg:h-dvh">
        {apiStale && (
          <div className="animate-reveal border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">
            API unreachable — showing cached catalog.
          </div>
        )}
        {shareError && (
          <div className="animate-reveal border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-900">{shareError}</div>
        )}
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b bg-white px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-7 grid-cols-2 gap-0.5 rounded-md bg-ink p-1.5"
            >
              <span className="rounded-[2px] bg-titan" />
              <span className="rounded-[2px] bg-white/30" />
              <span className="rounded-[2px] bg-white/30" />
              <span className="rounded-[2px] bg-white" />
            </span>
            <h1 className="font-display text-lg font-semibold tracking-tight">
              CSUF Schedule Builder
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Term"
              value={termId ?? ''}
              onChange={(e) => {
                const t = terms.find((x) => x.id === Number(e.target.value));
                if (t) setTerm(t.id, t.name);
              }}
              className="field !w-auto font-medium"
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
        <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
          <aside className="border-b bg-white lg:w-96 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <CourseSearch />
            <SolverPanel />
          </aside>
          <main className="min-w-0 flex-1 overflow-auto p-3 lg:p-5">
            <CalendarGrid ghost={ghost} />
          </main>
        </div>
        <footer className="border-t bg-white px-5 py-1.5 text-xs text-muted">
          {dataFrom ? `Data from ${fmtDataFrom(dataFrom)}` : 'Data freshness unknown'}
        </footer>
      </div>
      <DragOverlay>
        {drag && (
          <div className="w-max rotate-2 cursor-grabbing rounded-lg border border-ink/20 bg-white px-3 py-2 font-display text-sm font-semibold shadow-xl shadow-ink/20">
            {drag.course.deptCode} {drag.course.catalogNbr} · Sec {drag.section.sectionCode}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
