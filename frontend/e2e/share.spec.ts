import { test, expect } from './support/fixtures';
import { APP_URL } from './support/env';

test('share: public page renders names only, revoke hides it', async ({ page, api, seed, browser }) => {
  const [sol] = await api.get<any[]>(`/cohorts/${seed.full}/solutions`);
  const { share_token } = await api.post(`/solutions/${sol.id}/share`);

  const pub = await api.get(`/share/${share_token}`);
  expect(Array.isArray(pub.classes)).toBe(true);
  expect(pub).not.toHaveProperty('score');
  expect(JSON.stringify(pub)).not.toContain('last_name');

  // Anonymous visitor (fresh context, no cookies).
  const anon = await browser.newPage({ storageState: { cookies: [], origins: [] } });
  await anon.goto(`${APP_URL}/share/${share_token}`);
  await expect(anon.getByText('Class Lists')).toBeVisible();
  await expect(anon.locator('.roster-class-card')).toHaveCount(3);
  await expect(anon.locator('.roster-class-card').first()).toContainText('Class A');

  await api.del(`/solutions/${sol.id}/share`);
  await anon.reload();
  await expect(anon.getByText('This link is no longer available.')).toBeVisible();
  await anon.close();
});
