import path from 'node:path';
import { test, expect } from './support/fixtures';
import { E2E_DIR, PREFIX } from './support/env';

// Synthetic school export (fake names) covering: surname-first "Nombre", compound
// surnames ("Fuentes De La Vega"), two given names, a "Curso" column that should
// become tags, a numeric "N°" column to ignore, a typo ("Isidoro Paz"), a student
// who doesn't exist ("Martina Rios"), a surname initial ("Mateo R") and accent-insensitive
// matching ("Benjamin" vs "Benjamín").
const CSV = path.join(E2E_DIR, 'fixtures', 'school-export.csv');
// Re-upload into the same cohort: an exact copy of Sofía that lists a new classmate, Tomás
// with a different "Curso" (possible duplicate), and a new student listed twice (exact copy).
const CSV_AGAIN = path.join(E2E_DIR, 'fixtures', 'school-export-again.csv');

test('CSV import: preview, name splitting, tags, multi-select decisions, duplicates', async ({ page }) => {
  await page.goto('/cohorts');
  await page.getByRole('button', { name: /New cohort/ }).first().click();
  await page.getByPlaceholder('Year 3 — 2026').fill(`${PREFIX} import`);
  await page.getByRole('button', { name: 'Create cohort' }).click();
  await page.waitForURL(/\/cohorts\/[^/]+/);

  await page.locator('input[type="file"]').setInputFiles(CSV);
  const modal = page.getByRole('dialog', { name: 'Preview import' });
  await expect(modal.locator('tbody tr')).toHaveCount(14);
  await expect(modal.locator('th', { hasText: 'Pair with' })).toHaveCount(1);
  // How the single "Nombre" column was split is shown, with a way to flip it.
  await expect(modal.locator('.name-split-note')).toContainText('Arce Molina Sofía');
  await expect(modal.getByRole('button', { name: 'Names are written first name first' })).toBeVisible();

  const row = (i: number) => modal.locator('tbody tr').nth(i);
  await expect(row(0).getByLabel(/First name, line/)).toHaveValue('Sofía');
  await expect(row(0).getByLabel(/Last name, line/)).toHaveValue('Arce Molina');
  await expect(row(1).getByLabel(/Last name, line/)).toHaveValue('Fuentes De La Vega'); // compound surname
  await expect(row(2).getByLabel(/First name, line/)).toHaveValue('Juan Pablo');         // two given names

  await expect(modal.locator('.column-notes')).toContainText('curso-2a');
  await expect(modal.locator('.column-notes')).toContainText('N°');
  await expect(row(0)).toContainText('curso-2a');

  // No gender column: every gender is guessed from the first name, marked "?", and fixable.
  const guessed = modal.locator('.warn-banner', { hasText: 'guessed from first names' });
  await expect(guessed).toContainText('14 genders were guessed');
  await expect(row(0).locator('button.gender-cycle')).toHaveText('Girl?');
  const tomasGender = row(1).locator('button.gender-cycle');
  await expect(tomasGender).toHaveText('Boy?');
  await tomasGender.click();                       // Boy -> Girl: confirmed, no longer a guess
  await expect(tomasGender).toHaveText('Girl');
  await expect(guessed).toContainText('13 genders were guessed');
  await tomasGender.click();
  await tomasGender.click();                       // Girl -> unknown -> Boy
  await expect(tomasGender).toHaveText('Boy');

  const panel = modal.locator('.decision-panel');
  await expect(panel.locator('.decision-item')).toHaveCount(2);
  const confirm = modal.locator('.modal-footer .btn-primary');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText('Decide 2 names first');
  await expect(modal.getByText('Decide what to do with the unmatched pairing names first')).toBeVisible();

  const typo = panel.locator('.decision-item', { hasText: 'Isidoro Paz' });
  const missing = panel.locator('.decision-item', { hasText: 'Martina Rios' });
  await expect(typo).toContainText('1 student lists it');
  await typo.getByRole('checkbox', { name: 'Isidora Paz Ulloa' }).check();

  // Multi-select: Lucía meant both candidates -> two "together" preferences from one name.
  await missing.getByRole('checkbox', { name: 'Martina Vidal Cruz' }).check();
  await missing.getByRole('checkbox', { name: 'Elena Rios Castro' }).check();
  await expect(panel).toContainText('All classmate names are decided');
  await expect(row(3).locator('.pref-chip', { hasText: 'Martina Vidal Cruz' })).toBeVisible();
  await expect(row(3).locator('.pref-chip', { hasText: 'Elena Rios Castro' })).toBeVisible();
  await expect(confirm).toHaveText('Confirm import (14 students)');

  await confirm.click();
  await expect(page.locator('.toast').first()).toContainText(/14 students added, \d+ "keep together" preferences created/);
  await expect(page.locator('button.gender-cycle')).toHaveCount(14);

  // --- duplicates on a second upload ---
  await page.locator('input[type="file"]').setInputFiles(CSV_AGAIN);
  await expect(modal.locator('tbody tr')).toHaveCount(4);
  const sofia = modal.locator('tbody tr').nth(0);
  const tomas = modal.locator('tbody tr').nth(1);
  const anaCopy = modal.locator('tbody tr').nth(3);
  await expect(sofia).toContainText('Exact copy');
  await expect(sofia.getByRole('checkbox', { name: /Import line/ })).not.toBeChecked();
  await expect(sofia).toContainText('Added to the student already in the cohort.');
  await expect(tomas).toContainText('Possible duplicate');
  await expect(tomas).toContainText(/\(tags differ\)/); // a guessed gender never counts as differing
  await expect(tomas.getByRole('checkbox', { name: /Import line/ })).toBeChecked();
  await expect(anaCopy).toContainText('Identical to line 4');
  await expect(anaCopy.getByRole('checkbox', { name: /Import line/ })).not.toBeChecked();
  await expect(modal.locator('.warn-banner', { hasText: 'exact cop' })).toBeVisible();

  await tomas.getByRole('checkbox', { name: /Import line/ }).uncheck();
  await expect(confirm).toHaveText('Confirm import (1 student)');
  await confirm.click();

  // Something wasn't imported, and Sofía got a new preference: a summary instead of a silent close.
  const summary = page.getByRole('dialog', { name: 'Import finished' });
  await expect(summary).toContainText('1 student added, 1 "keep together" preference created.');
  await expect(summary).toContainText('Preferences added to students already in the cohort');
  await expect(summary).toContainText('Sofía Arce Molina: 1 new');
  await expect(summary).toContainText('Not imported (1)');
  await expect(summary).toContainText('Tomás Fuentes De La Vega');
  await summary.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('button.gender-cycle')).toHaveCount(15);
});

test.describe('upload errors', () => {
  test.use({ allowHttpErrors: true }); // the 422 is the point of the test

  test('CSV import: a file without a header row gets a specific error', async ({ page, api }) => {
    const cohort = await api.createCohort('import no header');
    await page.goto(`/cohorts/${cohort.id}`);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'sin-cabecera.csv', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('Ana;Soto\nLuis;Paz\n'),
    });
    await expect(page.getByRole('alert')).toContainText('We couldn’t find a name column');
  });
});
