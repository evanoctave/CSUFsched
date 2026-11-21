// One colour per course, shared by the calendar, the solver list and the previews.
const COURSE_COLORS = [
  { block: 'bg-sky-100 border-sky-600 text-sky-950', dot: 'bg-sky-500' },
  { block: 'bg-orange-100 border-orange-500 text-orange-950', dot: 'bg-orange-500' },
  { block: 'bg-teal-100 border-teal-600 text-teal-950', dot: 'bg-teal-500' },
  { block: 'bg-violet-100 border-violet-600 text-violet-950', dot: 'bg-violet-500' },
  { block: 'bg-rose-100 border-rose-500 text-rose-950', dot: 'bg-rose-500' },
  { block: 'bg-lime-100 border-lime-600 text-lime-950', dot: 'bg-lime-600' },
];

export const courseColor = (courseId: number) => COURSE_COLORS[courseId % COURSE_COLORS.length];
