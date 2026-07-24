import { test, expect } from '@playwright/test';
import { stubApi } from './fixtures';

test('golden path: search → drag section → paint busy → solve → share roundtrip', async ({
  page,
}) => {
  await stubApi(page);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  // Term auto-selected, freshness footer visible
  await expect(page.getByText('Data from Jul 20')).toBeVisible();

  // Search: pick department, expand course
  await page.getByLabel('Department').selectOption('CPSC');
  await page.getByText('CPSC 121').click();
  await expect(page.getByText('Sec 01')).toBeVisible();

  // Drag section card onto calendar
  const card = page.getByText('Sec 01');
  const calendar = page.getByTestId('calendar');
  const cardBox = (await card.boundingBox())!;
  const calBox = (await calendar.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(calBox.x + calBox.width / 2, calBox.y + calBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('calendar').getByText('CPSC 121').first()).toBeVisible();

  // Paint a busy block on Tuesday
  const tueCol = page.getByTestId('col-Tu');
  const tueBox = (await tueCol.boundingBox())!;
  await page.mouse.move(tueBox.x + tueBox.width / 2, tueBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(tueBox.x + tueBox.width / 2, tueBox.y + 180, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel(/Busy .* — click to remove/)).toBeVisible();

  // Solver: add course, generate, load a candidate
  await page.getByRole('button', { name: '+ Solver' }).click();
  await page.getByRole('button', { name: 'Generate schedules' }).click();
  await expect(page.getByTestId('candidate').first()).toBeVisible();
  await page.getByTestId('candidate').first().click();

  // Share roundtrip: navigate to share href in a fresh state
  const href = await page.getByTestId('share-link').getAttribute('href');
  expect(href).toContain('#s=');
  await page.addInitScript(() => localStorage.clear());
  await page.goto(href!);
  await expect(page.getByTestId('calendar').getByText('CPSC 121').first()).toBeVisible();
  await expect(page.getByLabel(/Busy .* — click to remove/)).toBeVisible();
});
