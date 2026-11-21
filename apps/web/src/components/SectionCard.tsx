import { useDraggable } from '@dnd-kit/core';
import type { CourseWithSections, Section } from '@csufsched/types';
import { fmtDays, fmtRange } from '../lib/time.ts';
import { ProfPopover } from './ProfPopover.tsx';

export interface DragData {
  course: CourseWithSections;
  section: Section;
}

export function SectionCard({ course, section }: DragData) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sec-${section.id}`,
    data: { course, section } satisfies DragData,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-testid={`section-card-${section.id}`}
      className={`cursor-grab touch-none space-y-0.5 rounded-lg border bg-white p-2.5 text-xs transition hover:-translate-y-px hover:border-ink/35 hover:shadow-md hover:shadow-ink/10 active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{`Sec ${section.sectionCode}`}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
            section.enrollmentStatus === 'open'
              ? 'bg-emerald-100 text-emerald-800'
              : section.enrollmentStatus === 'waitlist'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-red-100 text-red-800'
          }`}
        >
          {section.enrollmentStatus}
        </span>
      </div>
      <div className="text-muted">
        {section.meetings.length === 0
          ? 'Online / async'
          : section.meetings
              .map((m) => `${fmtDays(m.days)} ${fmtRange(m.startMin, m.endMin)}`)
              .join(', ')}
      </div>
      <div>
        {section.professor !== null ? <ProfPopover prof={section.professor} /> : 'Staff'}
      </div>
      {section.professor !== null && section.professor.topTags.length > 0 && (
        <div className="pt-1">
          {section.professor.topTags.slice(0, 2).map((tag) => (
            <span key={tag} className="mr-1 inline-block rounded-full bg-paper px-2 py-0.5 text-muted">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
