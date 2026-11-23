import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';

async function openRoster(page: Page, cohortId: string, card = 0) {
  await page.goto(`/cohorts/${cohortId}?tab=solutions`);
  const cards = page.locator('.solution-cards').first().locator('.solution-card');
  await cards.nth(card).getByRole('button', { name: 'View class lists' }).click();
  return page.getByRole('dialog');
}

for (const [label, key, classes, students] of [['3 classes', 'full', 3, 24], ['2 classes', 'noGender', 2, 10]] as const) {
  test(`roster modal (${label}): compact, expanded map, keyboard, close`, async ({ page, api, seed }) => {
    const cohortId = seed[key];
    await page.goto(`/cohorts/${cohortId}?tab=solutions`);
    const cards = page.locator('.solution-cards').first().locator('.solution-card');

    // Every card opens its own roster; Escape closes and returns focus.
    for (let i = 0; i < 3; i++) {
      const name = await cards.nth(i).locator('.solution-name').innerText();
      await cards.nth(i).getByRole('button', { name: 'View class lists' }).click();
      const dlg = page.getByRole('dialog');
      await expect(dlg.locator('h2')).toHaveText(`${name} — class lists`);
      await expect(dlg).toHaveAttribute('aria-modal', 'true');
      await expect(dlg.locator('.name-chip')).toHaveCount(students);
      await expect(dlg.locator('.roster-block')).toHaveCount(classes);
      await page.keyboard.press('Escape');
      await expect(dlg).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('View class lists');
    }

    const dlg = await openRoster(page, cohortId);
    for (let k = 0; k < 8; k++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true); // focus trapped

    await dlg.getByRole('button', { name: 'Expand' }).click();
    await expect(dlg.locator('.pref-map')).toBeVisible();
    await expect(dlg.locator('.pref-map svg circle[stroke="#fff"]')).toHaveCount(students);
    await expect(dlg.locator('.pref-initials')).toHaveCount(students);
    const pairs = new Set((await api.get(`/cohorts/${cohortId}/constraints`)).binary
      .filter((b: any) => b.type === 'together').map((b: any) => [b.student_a_id, b.student_b_id].sort().join('|')));
    await expect(dlg.locator('.pref-map line')).toHaveCount(pairs.size);
    const pts = await dlg.locator('.pref-map svg circle[stroke="#fff"]').evaluateAll((els) =>
      els.map((e) => [+e.getAttribute('cx')!, +e.getAttribute('cy')!, +e.getAttribute('r')!]));
    let minGap = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
      minGap = Math.min(minGap, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) - pts[i][2] * 2);
    expect(minGap).toBeGreaterThan(0); // nodes don't overlap
    await expect(dlg.locator('.pref-legend span:has(i)')).toHaveCount(classes);

    await dlg.getByRole('button', { name: 'Collapse' }).click();
    await expect(dlg.locator('.roster-block')).toHaveCount(classes);
    await page.mouse.click(5, 5); // scrim
    await expect(dlg).toHaveCount(0);
    await cards.first().getByRole('button', { name: 'View class lists' }).click();
    await expect(page.getByRole('dialog').locator('.roster-block')).toHaveCount(classes); // reopens compact
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 800 });
    const narrow = await openRoster(page, cohortId);
    await narrow.getByRole('button', { name: 'Expand' }).click();
    expect(await page.evaluate(() => {
      const m = document.querySelector('.roster-modal')!;
      return document.documentElement.scrollWidth <= innerWidth && m.scrollWidth <= m.clientWidth;
    })).toBe(true);
  });
}

test('roster modal links to the full solution page', async ({ page, seed }) => {
  const dlg = await openRoster(page, seed.full);
  await dlg.getByRole('button', { name: 'Expand' }).click();
  await dlg.getByRole('link', { name: /Open full page/ }).click();
  await expect(page).toHaveURL(/\/solutions\//);
  await expect(page.getByText('/ 100 score')).toBeVisible();
  await expect(page.locator('.roster-class-card')).toHaveCount(3);
  await expect(page.locator('.roster-class-card').first()).toContainText('Class A');
  await expect(page.getByRole('button', { name: /share/i }).first()).toBeVisible();
});
