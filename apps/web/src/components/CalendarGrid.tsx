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
import { courseColor } from '../lib/colors.ts';

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
    <div
      ref={setNodeRef}
      className="relative flex min-w-[640px] select-none rounded-xl border bg-white shadow-sm shadow-ink/5"
      data-testid="calendar"
    >
      {placed.length === 0 && busyBlocks.length === 0 && ghost === null && paint === null && (
        <p className="pointer-events-none absolute inset-x-0 top-40 z-10 mx-auto w-fit max-w-xs rounded-full bg-paper px-4 py-2 text-center text-xs text-muted">
          Drag a section here to place it, or drag on a day to block out busy time.
        </p>
      )}
      {/* hour gutter */}
      <div className="w-16 shrink-0">
        <div className="sticky top-0 z-20 h-10 rounded-tl-xl border-b bg-white" />
        <div className="relative" style={{ height: `${GRID_HEIGHT}px` }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute right-2 pt-1 text-[11px] text-muted"
              style={{ top: `${h - GRID_START_MIN}px` }}
            >
              {minToLabel(h)}
            </div>
          ))}
        </div>
      </div>
      {/* day columns */}
      {DAY_ORDER.map((day, dayIdx) => (
        <div key={day} className="min-w-0 flex-1 border-l">
          <div
            className={`sticky top-0 z-20 grid h-10 place-items-center border-b bg-white font-display text-sm font-semibold ${
              dayIdx === DAY_ORDER.length - 1 ? 'rounded-tr-xl' : ''
            }`}
          >
            {DAY_LABELS[day]}
          </div>
          <div
            className="relative cursor-crosshair"
            style={{ height: `${GRID_HEIGHT}px` }}
            data-testid={`col-${day}`}
            onPointerDown={(e) => onPointerDown(day, e)}
            onPointerMove={(e) => onPointerMove(day, e)}
            onPointerUp={onPointerUp}
          >
            {HOURS.map((h) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t border-line/60"
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
                  className="busy-hatch absolute inset-x-1 animate-pop rounded-md text-[11px] font-medium text-muted transition hover:brightness-95"
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
                    className={`absolute inset-x-1 animate-pop cursor-default overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-[11px] leading-tight shadow-sm shadow-ink/10 ${courseColor(course.id).block}`}
                    style={blockStyle(m.startMin, m.endMin)}
                  >
                    <span className="font-display font-semibold">{`${course.deptCode} ${course.catalogNbr}`}</span>
                    <span className="block opacity-75">{fmtRange(m.startMin, m.endMin)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${course.deptCode} ${course.catalogNbr}`}
                      className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded text-sm leading-none opacity-50 transition hover:bg-black/10 hover:opacity-100 focus-visible:opacity-100"
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
                    className={`pointer-events-none absolute inset-x-1 rounded-md border-2 border-dashed transition-colors ${
                      ghost.conflict
                        ? 'border-red-500 bg-red-200/60'
                        : 'border-emerald-500 bg-emerald-200/60'
                    }`}
                    style={blockStyle(m.startMin, m.endMin)}
                  />
                ))}
            {paintPreview !== null && paintPreview.day === day && (
              <div
                className="busy-hatch pointer-events-none absolute inset-x-1 rounded-md"
                style={blockStyle(paintPreview.startMin, paintPreview.endMin)}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
