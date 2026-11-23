import path from 'node:path';
import { test, expect } from './support/fixtures';
import { E2E_DIR, PREFIX } from './support/env';

// Synthetic school export (fake names) covering: surname-first "Nombre", compound
// surnames ("Fuentes De La Vega"), two given names, a "Curso" column that should
// become tags, a numeric "N°" column to ignore, a typo ("Isidoro Paz"), a student
// who doesn't exist ("Martina Rios"), a surname initial ("Mateo R") and accent-insensitive
// matching ("Benjamin" vs "Benjamín").
const CSV = path.join(E2E_DIR, 'fixtures', 'school-export.csv');

test('CSV import: preview, name splitting, tags, unmatched-name decisions', async ({ page }) => {
  await page.goto('/cohorts');
  await page.getByRole('button', { name: /New cohort/ }).first().click();
  await page.getByPlaceholder('Year 3 — 2026').fill(`${PREFIX} import`);
  await page.getByRole('button', { name: 'Create cohort' }).click();
  await page.waitForURL(/\/cohorts\/[^/]+/);

  await page.locator('input[type="file"]').setInputFiles(CSV);
  const modal = page.locator('.modal', { hasText: 'Preview import' });
  await expect(modal.locator('tbody tr')).toHaveCount(14);
  await expect(modal.locator('th', { hasText: 'Pair with' })).toHaveCount(1);

  const row = (i: number) => modal.locator('tbody tr').nth(i);
  await expect(row(0).locator('input').nth(0)).toHaveValue('Sofía');
  await expect(row(0).locator('input').nth(1)).toHaveValue('Arce Molina');
  await expect(row(1).locator('input').nth(1)).toHaveValue('Fuentes De La Vega'); // compound surname
  await expect(row(2).locator('input').nth(0)).toHaveValue('Juan Pablo');         // two given names

  await expect(modal.locator('.column-notes')).toContainText('curso-2a');
  await expect(modal.locator('.column-notes')).toContainText('N°');
  await expect(row(0).locator('td').nth(2)).toContainText('curso-2a');

  const panel = modal.locator('.decision-panel');
  await expect(panel.locator('.decision-item')).toHaveCount(2);
  const confirm = modal.locator('.modal-footer .btn-primary');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText('Decide 2 names first');

  const typo = panel.locator('.decision-item', { hasText: 'Isidoro Paz' });
  const missing = panel.locator('.decision-item', { hasText: 'Martina Rios' });
  await expect(typo.getByRole('button', { name: 'Isidora Paz Ulloa' })).toBeVisible();
  await expect(missing.getByRole('button', { name: 'Martina Vidal Cruz' })).toBeVisible();
  await expect(missing.getByRole('button', { name: 'Elena Rios Castro' })).toBeVisible();

  await typo.getByRole('button', { name: 'Isidora Paz Ulloa' }).click();
  await missing.getByRole('button', { name: /Add “Martina Rios” as a new student/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(modal.locator('tbody tr')).toHaveCount(15);
  await expect(confirm).toBeEnabled();

  await confirm.click();
  await expect(page.locator('.toast').first()).toContainText(/15 students added, \d+ "keep together" preferences created/);
  await expect(page.locator('button.gender-cycle')).toHaveCount(15);
});
