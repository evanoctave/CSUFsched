import type { Day, Section, SolverPrefs } from '@csufsched/types';

export function totalGapMinutes(sections: Section[]): number {
  const byDay = new Map<Day, Array<[number, number]>>();
  for (const s of sections) {
    for (const m of s.meetings) {
      for (const d of m.days) {
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push([m.startMin, m.endMin]);
      }
    }
  }
  let gaps = 0;
  for (const intervals of byDay.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++) {
      gaps += Math.max(0, intervals[i][0] - intervals[i - 1][1]);
    }
  }
  return gaps;
}

export function daysOnCampus(sections: Section[]): number {
  const days = new Set<Day>();
  for (const s of sections) for (const m of s.meetings) for (const d of m.days) days.add(d);
  return days.size;
}

export function avgProfRating(sections: Section[]): number {
  if (sections.length === 0) return 3;
  const ratings = sections.map((s) => s.professor?.rating ?? 3);
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

export function scoreCombo(sections: Section[], prefs: SolverPrefs): number {
  const ratingScore = (avgProfRating(sections) - 1) / 4;
  const gapScore = Math.max(0, 1 - totalGapMinutes(sections) / 480);
  const dayScore = (6 - daysOnCampus(sections)) / 6;
  return (
    100 *
    (prefs.weightProfRating * ratingScore +
      prefs.weightMinimizeGaps * gapScore +
      0.2 * dayScore)
  );
}
