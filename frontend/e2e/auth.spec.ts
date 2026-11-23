import { test, expect } from './support/fixtures';
import { APP_URL, credentials } from './support/env';

// Fresh, logged-out visitor with English pinned (selectors are English).
test.use({ allowHttpErrors: true, storageState: { cookies: [], origins: [{ origin: APP_URL, localStorage: [{ name: 'lang', value: 'en' }] }] } });

// These only exercise paths that don't create Supabase accounts or send email.
test('login: success shows the nav without a reload; wrong password is a clear error', async ({ page }) => {
  const { email, password } = credentials();
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', `${password}-wrong`);
  await page.click('button[type="submit"]');
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();

  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/cohorts');
  // Login used to store the whole { teacher } response as the teacher, so the nav had
  // no school name until a reload re-fetched /auth/me.
  const school = (await (await page.request.get('http://localhost:8000/auth/me')).json()).school_name;
  await expect(page.locator('.nav-school')).toHaveText(school);
});

test('register: an existing email is reported on the email field, not a generic error', async ({ page }) => {
  const { email } = credentials();
  await page.goto('/register');
  await page.getByPlaceholder('Sunnybrook Primary').fill('Any School');
  await page.fill('input[type="email"]', email);
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill('a-long-enough-password');
  await pw.nth(1).fill('a-long-enough-password');
  await page.getByRole('button', { name: /Create account/ }).click();
  await expect(page.getByText('An account with this email already exists. Sign in instead.')).toBeVisible();
  await expect(page.getByText('Check your email')).toHaveCount(0);
});
