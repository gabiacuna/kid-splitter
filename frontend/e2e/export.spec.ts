import { readFileSync } from 'node:fs';
import { test, expect } from './support/fixtures';

test('export: .xlsx download from the expanded roster', async ({ page, seed }) => {
  await page.goto(`/cohorts/${seed.full}?tab=solutions`);
  await page.locator('.solution-card').first().getByRole('button', { name: 'View class lists' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('button', { name: 'Download .xlsx' })).toHaveCount(0); // not in compact view
  await dlg.getByRole('button', { name: 'Expand' }).click();

  const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Download .xlsx' }).click()]);
  const name = download.suggestedFilename();
  expect(name).toMatch(/ - (Soft priority|Diversity mix|Balanced sizes)-class-list\.xlsx$/);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a real .xlsx (zip), not CSV renamed
  expect(bytes.length).toBeGreaterThan(2000);
});

test('export: other ids are refused', async ({ api }) => {
  await expect(api.get('/solutions/00000000-0000-0000-0000-000000000000/export.xlsx')).rejects.toThrow(/404/);
});
