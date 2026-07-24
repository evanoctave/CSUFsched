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
      className={`cursor-grab rounded border bg-white p-2 text-xs ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{`Sec ${section.sectionCode}`}</span>
        <span
          className={`rounded px-1 ${
            section.enrollmentStatus === 'open'
              ? 'bg-green-100 text-green-800'
              : section.enrollmentStatus === 'waitlist'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-red-100 text-red-800'
          }`}
        >
          {section.enrollmentStatus}
        </span>
      </div>
      <div className="text-gray-600">
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
        <div className="mt-1">
          {section.professor.topTags.slice(0, 2).map((tag) => (
            <span key={tag} className="mr-1 inline-block rounded bg-gray-100 px-1">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
