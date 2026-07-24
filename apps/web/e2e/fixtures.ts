import type { Page } from '@playwright/test';

export const TERMS = [{ id: 7, code: '2268', name: 'Fall 2026' }];

export const DEPTS = [{ id: 1, code: 'CPSC', name: 'Computer Science' }];

export const COURSES = [
  {
    id: 1,
    deptCode: 'CPSC',
    catalogNbr: '121',
    title: 'Programming I',
    units: 3,
    sections: [
      {
        id: 11,
        courseId: 1,
        classNbr: '12345',
        sectionCode: '01',
        mode: 'in-person',
        enrollmentStatus: 'open',
        professor: {
          id: 5,
          fullName: 'Ada Lovelace',
          rating: 4.5,
          difficulty: 2.8,
          wouldTakeAgainPct: 92,
          topTags: ['clear lectures', 'caring'],
        },
        meetings: [{ days: ['M', 'W'], startMin: 600, endMin: 675, building: 'CS', room: '101' }],
      },
    ],
  },
];

export const PROF = {
  id: 5,
  fullName: 'Ada Lovelace',
  rating: 4.5,
  difficulty: 2.8,
  wouldTakeAgainPct: 92,
  numRatings: 40,
  rmpUrl: 'https://www.ratemyprofessors.com/professor/5',
  tags: [
    { tag: 'clear lectures', count: 12 },
    { tag: 'caring', count: 8 },
  ],
};

export const META = { dataFrom: '2026-07-20T12:00:00.000Z' };

export async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/terms', (route) => route.fulfill({ json: TERMS }));
  await page.route('**/api/terms/*/departments', (route) => route.fulfill({ json: DEPTS }));
  await page.route('**/api/terms/*/courses**', (route) => route.fulfill({ json: COURSES }));
  await page.route('**/api/professors/*', (route) => route.fulfill({ json: PROF }));
  await page.route('**/api/sections**', (route) => route.fulfill({ json: COURSES }));
  await page.route('**/api/meta', (route) => route.fulfill({ json: META }));
}
