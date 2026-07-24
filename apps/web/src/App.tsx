import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CalendarGrid, type GhostInfo } from './components/CalendarGrid.tsx';
import { CourseSearch } from './components/CourseSearch.tsx';
import type { DragData } from './components/SectionCard.tsx';
import { resolveDrop } from './lib/dnd.ts';
import { dropConflicts } from './lib/conflicts.ts';
import { placedSections, useScheduleStore } from './store.ts';

export default function App() {
  const busyBlocks = useScheduleStore((s) => s.busyBlocks);
  const catalog = useScheduleStore((s) => s.catalog);
  const placedSectionIds = useScheduleStore((s) => s.placedSectionIds);
  const placeSection = useScheduleStore((s) => s.placeSection);
  const placed = useMemo(
    () => placedSections({ catalog, placedSectionIds }),
    [catalog, placedSectionIds],
  );

  const [drag, setDrag] = useState<DragData | null>(null);
  const [ghost, setGhost] = useState<GhostInfo | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function onDragStart(e: DragStartEvent) {
    setDrag((e.active.data.current as DragData | undefined) ?? null);
  }

  function onDragOver(e: DragOverEvent) {
    const data = e.active.data.current as DragData | undefined;
    if (data !== undefined && e.over?.id === 'calendar') {
      setGhost({
        section: data.section,
        conflict: dropConflicts(
          data.section,
          placed.map((p) => p.section),
          busyBlocks,
        ),
      });
    } else {
      setGhost(null);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const data = e.active.data.current as DragData | undefined;
    const overId = e.over === null ? null : String(e.over.id);
    if (
      data !== undefined &&
      resolveDrop(data.section, overId, placed.map((p) => p.section), busyBlocks) === 'place'
    ) {
      placeSection(data.course, data.section.id);
    }
    setDrag(null);
    setGhost(null);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="min-h-screen bg-gray-50">
        <header className="border-b bg-white px-4 py-2">
          <h1 className="text-lg font-semibold">CSUF Schedule Builder</h1>
        </header>
        <div className="flex">
          <aside className="w-80 shrink-0 border-r">
            <CourseSearch />
          </aside>
          <main className="min-w-0 flex-1 p-2">
            <CalendarGrid ghost={ghost} />
          </main>
        </div>
      </div>
      <DragOverlay>
        {drag !== null && (
          <div className="rounded border bg-white p-2 text-xs shadow-lg">
            {`${drag.course.deptCode} ${drag.course.catalogNbr} · Sec ${drag.section.sectionCode}`}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
