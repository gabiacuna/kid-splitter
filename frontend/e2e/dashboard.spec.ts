import { test, expect } from './support/fixtures';

test('dashboard: Active/Draft cards, last solved, stable tints, one column when narrow', async ({ page, api, seed }) => {
  const draft = await api.createCohort('dashboard draft');
  const solved = await api.get(`/cohorts/${seed.full}`);
  const students = await api.get(`/cohorts/${seed.full}/students`);
  expect(solved.last_solve_at).toBeTruthy();
  expect(solved.student_count).toBe(students.length); // not inflated by joining solutions

  await page.goto('/cohorts');
  const card = (name: string) => page.locator('.cohort-card', { has: page.locator('h2', { hasText: name }) });
  await expect(card(solved.name).locator('.status-pill')).toHaveText('Active');
  await expect(card(solved.name).locator('.cohort-solved')).toHaveText(/Last solved (just now|\d+ \w+ ago)/);
  await expect(card(solved.name).locator('.cohort-sub')).toHaveText(/24 students · 3 classes/);
  await expect(card(draft.name).locator('.status-pill')).toHaveText('Draft');
  await expect(card(draft.name)).toContainText('No solves yet');
  await expect(card(draft.name)).toHaveClass(/empty/);

  const tints = () => page.locator('.cohort-icon').evaluateAll((els) => els.map((e) => e.getAttribute('style')));
  const before = await tints();
  await page.reload();
  await page.locator('.cohort-icon').first().waitFor();
  expect(await tints()).toEqual(before);

  await card(solved.name).getByRole('button', { name: 'Cohort options' }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeFocused(); // focus moves into the menu
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await expect(card(solved.name).getByRole('button', { name: 'Cohort options' })).toBeFocused();

  await card(solved.name).getByRole('link', { name: 'Open →' }).click();
  await expect(page).toHaveURL(new RegExp(seed.full));

  await page.goto('/cohorts');
  await page.setViewportSize({ width: 600, height: 900 });
  expect(await page.locator('.cohort-grid').evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
