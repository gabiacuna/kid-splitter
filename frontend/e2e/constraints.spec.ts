import type { Page, Request } from '@playwright/test';
import { test, expect } from './support/fixtures';

const NAMES = [['Amara', 'Osei'], ['Ben', 'Kim'], ['George', 'Park'], ['Chloe', 'Reyes'], ['Daniel', 'Sato'], ['Emma', 'Tan'], ['Fiona', 'Lee'], ['Hugo', 'Diaz']];

const rows = (page: Page) => page.locator('.constraint-row.binary');
const rowWith = (page: Page, a: string, b: string) => rows(page)
  .filter({ has: page.locator('select[aria-label="Student A"] option:checked', { hasText: a }) })
  .filter({ has: page.locator('select[aria-label="Student B"] option:checked', { hasText: b }) });

/** Records POST/PUT/DELETE calls to constraint endpoints. */
function trackWrites(page: Page) {
  const writes: string[] = [];
  const on = (r: Request) => {
    if (['POST', 'PUT', 'DELETE'].includes(r.method()) && r.url().includes('/constraints')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  };
  page.on('request', on);
  return { writes, reset: () => { writes.length = 0; } };
}

test('constraint editor: conflict groups, autosave, advanced rules, narrow layout', async ({ page, api }) => {
  const cohort = await api.createCohort('constraints');
  const S: Record<string, string> = {};
  const ids = await api.addStudents(cohort.id, NAMES.map(([first_name, last_name]) => ({ first_name, last_name })));
  NAMES.forEach(([f], i) => { S[f] = ids[i]; });
  // Amara+Ben together, George+Ben together, George apart from Amara (all hard) -> one chain conflict.
  await api.together(cohort.id, S.Amara, S.Ben, { is_hard: true, weight: 5 });
  await api.together(cohort.id, S.George, S.Amara, { is_hard: true, weight: 5, type: 'separate' });
  await api.together(cohort.id, S.George, S.Ben, { is_hard: true, weight: 5 });
  await api.together(cohort.id, S.Emma, S.Amara, { weight: 3 });              // bystander: shares Amara, not in the conflict
  await api.together(cohort.id, S.Chloe, S.Daniel, { weight: 2, type: 'separate' });

  // The "All changes saved" label may already show from an earlier save, so wait on the
  // server state itself before reloading.
  const rule = async (a: string, b: string) => {
    const { binary } = await api.get(`/cohorts/${cohort.id}/constraints`);
    return binary.find((c: any) => c.student_a_id === S[a] && c.student_b_id === S[b]);
  };

  const url = `/cohorts/${cohort.id}?tab=constraints`;
  await page.goto(url);
  const { writes, reset } = trackWrites(page);

  // --- 04: conflict groups
  const banner = page.locator('.conflict-banner');
  await expect(banner).toContainText('1 contradiction found — resolve before solving.');
  await expect(page.locator('.constraint-row.binary .conflict-badge')).toHaveCount(3);
  await expect(rowWith(page, 'Emma', 'Amara').locator('.conflict-badge')).toHaveCount(0);
  const bb = (await page.locator('.conflict-badge').first().boundingBox())!;
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }))
    .toBe('conflict-badge'); // badge not clipped or covered
  await banner.getByRole('button', { name: 'Why?' }).click();
  const why = banner.locator('.conflict-banner-body');
  await expect(why).toContainText('Amara O.');
  await expect(why).toContainText('George P.');
  expect(await why.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no UUIDs
  await expect(banner.locator('.conflict-chip')).toHaveCount(3);

  await page.goto(`/cohorts/${cohort.id}?tab=solutions`);
  await expect(page.getByText('Resolve constraint contradictions before solving.')).toBeVisible();
  await page.goto(url);

  // --- 05: autosave; a full slider drag is one PUT
  reset();
  const cd = rowWith(page, 'Chloe', 'Daniel');
  const slider = cd.locator('input[type="range"]');
  await slider.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let x = 2; x <= box.width - 2; x += 4) await page.mouse.move(box.x + x, box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  expect(writes.filter((w) => w.startsWith('PUT'))).toHaveLength(1);
  await expect(cd.locator('.weight-value')).toHaveText('10');

  // type + hard via keyboard
  const typeSel = cd.locator('select.type-select');
  await typeSel.focus();
  await page.keyboard.press('ArrowUp'); // separate -> together
  await cd.locator('.hard-check input').focus();
  await page.keyboard.press('Space');
  await expect(typeSel).toHaveValue('together');
  await expect(slider).toBeDisabled();
  await expect.poll(async () => { const r = await rule('Chloe', 'Daniel'); return `${r.type} ${r.is_hard}`; }).toBe('together true');
  await page.reload();
  const cdAfter = rowWith(page, 'Chloe', 'Daniel');
  await expect(cdAfter.locator('select.type-select')).toHaveValue('together');
  await expect(cdAfter.locator('.hard-check input')).toBeChecked();
  await expect(cdAfter.locator('.weight-value')).toHaveText('10');

  // changing a student on a saved rule persists
  await rowWith(page, 'Emma', 'Amara').locator('select[aria-label="Student B"]').selectOption({ label: 'Fiona Lee' });
  await expect.poll(async () => !!(await rule('Emma', 'Fiona'))).toBe(true);
  await page.reload();
  await expect(rowWith(page, 'Emma', 'Fiona')).toHaveCount(1);
  await expect(page.locator('.conflict-badge')).toHaveCount(3);

  // new row: incomplete stays client-side, complete row POSTs once then PUTs
  reset();
  await page.getByRole('button', { name: '+ Add constraint' }).click();
  await rows(page).last().locator('select[aria-label="Student A"]').selectOption({ label: 'Hugo Diaz' });
  await page.waitForTimeout(1200);
  expect(writes).toEqual([]);
  await page.reload();
  await expect(rows(page)).toHaveCount(5);
  await page.getByRole('button', { name: '+ Add constraint' }).click();
  const fresh = rows(page).last();
  await fresh.locator('select[aria-label="Student A"]').selectOption({ label: 'Hugo Diaz' });
  await fresh.locator('select[aria-label="Student B"]').selectOption({ label: 'Fiona Lee' });
  await expect.poll(async () => !!(await rule('Hugo', 'Fiona'))).toBe(true);
  await fresh.locator('select.type-select').selectOption('separate');
  await expect.poll(() => writes.filter((w) => w.startsWith('PUT')).length).toBe(1);
  expect(writes.filter((w) => w.startsWith('POST'))).toHaveLength(1);
  await page.reload();
  await expect(rowWith(page, 'Hugo', 'Fiona').locator('select.type-select')).toHaveValue('separate');

  // resolving the conflict clears the banner and badges
  await rowWith(page, 'George', 'Amara').locator('.hard-check input').uncheck();
  await expect(page.locator('.conflict-banner')).toHaveCount(0);
  await expect(page.locator('.conflict-badge')).toHaveCount(0);

  // delete asks for confirmation
  reset();
  await rowWith(page, 'Hugo', 'Fiona').getByRole('button', { name: 'Delete rule' }).click();
  await rowWith(page, 'Hugo', 'Fiona').getByRole('button', { name: 'Yes' }).click();
  await expect(rowWith(page, 'Hugo', 'Fiona')).toHaveCount(0);
  expect(writes.some((w) => w.startsWith('DELETE'))).toBe(true);

  // Advanced (unary): collapsed by default, CRUD works
  const adv = page.locator('details.advanced-constraints');
  expect(await adv.evaluate((d: HTMLDetailsElement) => d.open)).toBe(false);
  await adv.locator('summary').click();
  reset();
  await adv.getByRole('button', { name: '+ Add advanced rule' }).click();
  const u = adv.locator('.constraint-row.unary').last();
  await u.locator('select[aria-label="Student"]').selectOption({ label: 'Chloe Reyes' });
  await expect.poll(() => writes.some((w) => w.startsWith('POST') && w.includes('/unary'))).toBe(true);
  await u.getByRole('button', { name: 'Delete rule' }).click();
  await u.getByRole('button', { name: 'Yes' }).click();
  await expect.poll(() => writes.some((w) => w.startsWith('DELETE') && w.includes('/unary'))).toBe(true);

  // narrow layout
  await page.setViewportSize({ width: 600, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
