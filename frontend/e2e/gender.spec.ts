import { test, expect } from './support/fixtures';
import { fakeStudents } from './support/api';

test('gender: click-to-cycle with mouse and keyboard, persists (including back to unknown)', async ({ page, api }) => {
  const cohort = await api.createCohort('gender', { balance_gender: true });
  await api.addStudents(cohort.id, fakeStudents(3));
  await page.goto(`/cohorts/${cohort.id}?tab=students`);

  await expect(page.getByText(/no students have a gender set/)).toBeVisible();
  const cell = () => page.locator('button.gender-cycle').first();
  await cell().click();
  await expect(cell()).toHaveText('Boy');
  await cell().focus();
  await page.keyboard.press('Enter');
  await expect(cell()).toHaveText('Girl');
  await page.keyboard.press(' ');
  await expect(cell()).toHaveText('—');

  // Rapid clicks: writes are ordered per student, so the server ends on the last value.
  await cell().click(); await cell().click(); await cell().click(); await cell().click(); // Boy, Girl, —, Boy
  await expect(cell()).toHaveText('Boy');
  await expect.poll(async () => (await api.get(`/cohorts/${cohort.id}/students`))[0].gender).toBe('boy');
  await page.reload();
  await expect(cell()).toHaveText('Boy');

  await cell().click(); await cell().click(); // Girl, —
  await expect.poll(async () => (await api.get(`/cohorts/${cohort.id}/students`))[0].gender).toBeNull();
  await page.reload();
  await expect(cell()).toHaveText('—');
  await expect(page.getByText(/no students have a gender set/)).toBeVisible();
});

test('gender: balance checkbox persists via the edit modal', async ({ page, api }) => {
  const cohort = await api.createCohort('balance flag');
  await page.goto('/cohorts');
  const card = page.locator('.cohort-card', { has: page.locator('h2', { hasText: cohort.name }) });
  await card.getByRole('button', { name: 'Cohort options' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel(/balanced mix of boys and girls/).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await api.get(`/cohorts/${cohort.id}`)).balance_gender).toBe(true);
});
