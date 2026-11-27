import { test, expect } from './support/fixtures';

test('solutions: ranking, subtitles, class + gender bars (full data)', async ({ page, api, seed }) => {
  await page.goto(`/cohorts/${seed.full}?tab=solutions`);
  const cards = page.locator('.solution-cards').first().locator('.solution-card');
  await expect(cards).toHaveCount(3);

  const scores = (await cards.locator('.solution-score').allInnerTexts()).map(Number);
  expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  await expect(cards.first().locator('.solution-best-badge')).toHaveCount(1);
  await expect(page.locator('.solution-cards').first().locator('.solution-best-badge')).toHaveCount(1);
  await expect(cards.locator('.solution-subtitle').filter({ hasText: 'ignores preferences' })).toHaveCount(1);
  await expect(cards.first().locator('.hbar-label').first()).toHaveText('Class A');

  await expect(cards.first().getByText('Boy / girl balance')).toHaveCount(1);
  await expect(page.locator('.gender-legend').first()).toHaveText(/^\s*Boys\s*Girls\s*$/);
  await expect(page.locator('.gender-disclosure')).toHaveCount(0);

  // Gender values add up to the class sizes on every card.
  for (let i = 0; i < 3; i++) {
    const card = cards.nth(i);
    const sizes = (await card.locator('.bar-section').first().locator('.hbar-value').allInnerTexts()).map(Number);
    const gender = await card.locator('.bar-section').nth(1).locator('.hbar-value').allInnerTexts();
    gender.forEach((g, k) => {
      const [b, gg] = g.match(/\d+/g)!.map(Number);
      expect(b + gg).toBe(sizes[k]);
    });
  }

  // "Balanced sizes" ignores preferences, so it never balances gender better than "Soft priority".
  const sols = await api.get<any[]>(`/cohorts/${seed.full}/solutions`);
  const spread = (s: any) => s.gender_split.reduce((t: number, c: any) => t + Math.abs(c.boys - 4), 0);
  const by = Object.fromEntries(sols.map((s) => [s.label, s]));
  expect(spread(by.balanced_sizes)).toBeGreaterThanOrEqual(spread(by.soft_priority));
});

test('solutions: partial gender data shows unknown segment and disclosure', async ({ page, seed }) => {
  await page.goto(`/cohorts/${seed.partial}?tab=solutions`);
  await expect(page.locator('.seg.unknown').first()).toBeVisible();
  await expect(page.locator('.bar-section').nth(1).locator('.hbar-value').first()).toHaveText(/\d+B \/ \d+G \/ \d+\?/);
  const disclosure = page.locator('.gender-disclosure');
  await expect(disclosure).toContainText('8 of 20 students have no gender set');
  await expect(page.locator('.gender-legend').first()).toContainText('Not set');
  await disclosure.getByRole('link').click();
  await expect(page).toHaveURL(/tab=students/);
});

test('solutions: no gender data hides the gender section; cards stack when narrow', async ({ page, seed }) => {
  await page.goto(`/cohorts/${seed.noGender}?tab=solutions`);
  await expect(page.locator('.solution-card').first()).toBeVisible();
  await expect(page.getByText('Boy / girl balance')).toHaveCount(0);
  await expect(page.locator('.gender-legend')).toHaveCount(0);
  await expect(page.locator('.gender-disclosure')).toHaveCount(0);
  // The solve panel starts from the class count chosen for the cohort (2 here), not a fixed 3.
  await expect(page.locator('input[type="number"][max="4"]')).toHaveValue('2');

  await page.setViewportSize({ width: 600, height: 1000 });
  expect(await page.locator('.solution-cards').first().evaluate((e) => getComputedStyle(e).flexDirection)).toBe('column');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
