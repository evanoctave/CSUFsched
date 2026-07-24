import { useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Day, Section } from '@csufsched/types';
import {
  DAY_LABELS,
  DAY_ORDER,
  GRID_END_MIN,
  GRID_START_MIN,
  dragToBusyBlock,
  fmtRange,
  minToLabel,
} from '../lib/time.ts';
import { placedSections, useScheduleStore } from '../store.ts';

export interface GhostInfo {
  section: Section;
  conflict: boolean;
}

const GRID_HEIGHT = GRID_END_MIN - GRID_START_MIN; // 900px, 1px per minute
const HOURS = Array.from(
  { length: GRID_HEIGHT / 60 },
  (_, i) => GRID_START_MIN + i * 60,
);

function blockStyle(startMin: number, endMin: number) {
  return { top: `${startMin - GRID_START_MIN}px`, height: `${endMin - startMin}px` };
}

interface PaintState {
  day: Day;
  y0: number;
  y1: number;
}

export function CalendarGrid({ ghost }: { ghost: GhostInfo | null }) {
  const busyBlocks = useScheduleStore((s) => s.busyBlocks);
  const addBusyBlock = useScheduleStore((s) => s.addBusyBlock);
  const removeBusyBlock = useScheduleStore((s) => s.removeBusyBlock);
  const catalog = useScheduleStore((s) => s.catalog);
  const placedSectionIds = useScheduleStore((s) => s.placedSectionIds);
  const removeSection = useScheduleStore((s) => s.removeSection);
  const placed = useMemo(
    () => placedSections({ catalog, placedSectionIds }),
    [catalog, placedSectionIds],
  );
  const [paint, setPaint] = useState<PaintState | null>(null);
  const { setNodeRef } = useDroppable({ id: 'calendar' });

  function columnY(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY - rect.top;
  }

  function onPointerDown(day: Day, e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return; // clicks on blocks are not paints
    const y = columnY(e);
    setPaint({ day, y0: y, y1: y });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(day: Day, e: React.PointerEvent<HTMLDivElement>) {
    if (paint !== null && paint.day === day) setPaint({ ...paint, y1: columnY(e) });
  }

  function onPointerUp() {
    if (paint !== null) {
      const block = dragToBusyBlock(paint.day, paint.y0, paint.y1);
      if (block) addBusyBlock(block);
      setPaint(null);
    }
  }

  const paintPreview =
    paint !== null ? dragToBusyBlock(paint.day, paint.y0, paint.y1) : null;

  return (
    <div ref={setNodeRef} className="flex select-none" data-testid="calendar">
      {/* hour gutter */}
      <div className="w-16 shrink-0 pt-6">
        <div className="relative" style={{ height: `${GRID_HEIGHT}px` }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute right-1 -translate-y-1/2 text-xs text-gray-500"
              style={{ top: `${h - GRID_START_MIN}px` }}
            >
              {minToLabel(h)}
            </div>
          ))}
        </div>
      </div>
      {/* day columns */}
      {DAY_ORDER.map((day) => (
        <div key={day} className="min-w-0 flex-1 border-l">
          <div className="h-6 text-center text-xs font-medium text-gray-600">
            {DAY_LABELS[day]}
          </div>
          <div
            className="relative bg-white"
            style={{ height: `${GRID_HEIGHT}px` }}
            data-testid={`col-${day}`}
            onPointerDown={(e) => onPointerDown(day, e)}
            onPointerMove={(e) => onPointerMove(day, e)}
            onPointerUp={onPointerUp}
          >
            {HOURS.map((h) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t border-gray-100"
                style={{ top: `${h - GRID_START_MIN}px` }}
              />
            ))}
            {busyBlocks.map((b, i) =>
              b.day === day ? (
                <button
                  key={`busy-${i}`}
                  type="button"
                  aria-label={`Busy ${fmtRange(b.startMin, b.endMin)} — click to remove`}
                  onClick={() => removeBusyBlock(i)}
                  className="absolute inset-x-0.5 rounded bg-gray-400/70 text-[10px] text-white"
                  style={blockStyle(b.startMin, b.endMin)}
                >
                  Busy
                </button>
              ) : null,
            )}
            {placed.flatMap(({ course, section }) =>
              section.meetings
                .filter((m) => m.days.includes(day))
                .map((m, i) => (
                  <div
                    key={`sec-${section.id}-${i}`}
                    className="absolute inset-x-0.5 overflow-hidden rounded bg-blue-500 p-0.5 text-[10px] leading-tight text-white"
                    style={blockStyle(m.startMin, m.endMin)}
                  >
                    <span className="font-semibold">{`${course.deptCode} ${course.catalogNbr}`}</span>
                    <span className="block">{fmtRange(m.startMin, m.endMin)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${course.deptCode} ${course.catalogNbr}`}
                      className="absolute right-0.5 top-0.5"
                      onClick={() => removeSection(section.id)}
                    >
                      ×
                    </button>
                  </div>
                )),
            )}
            {ghost !== null &&
              ghost.section.meetings
                .filter((m) => m.days.includes(day))
                .map((m, i) => (
                  <div
                    key={`ghost-${i}`}
                    data-testid="ghost-block"
                    className={`pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed ${
                      ghost.conflict
                        ? 'border-red-500 bg-red-300/50'
                        : 'border-green-500 bg-green-300/50'
                    }`}
                    style={blockStyle(m.startMin, m.endMin)}
                  />
                ))}
            {paintPreview !== null && paintPreview.day === day && (
              <div
                className="pointer-events-none absolute inset-x-0.5 rounded bg-gray-300/60"
                style={blockStyle(paintPreview.startMin, paintPreview.endMin)}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
