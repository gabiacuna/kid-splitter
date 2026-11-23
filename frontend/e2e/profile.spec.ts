import { readFileSync } from 'node:fs';
import { test, expect } from './support/fixtures';

test.use({ allowHttpErrors: true });

const json = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

test('profile: nav link opens profile; editing school name updates nav immediately', async ({ page, api }) => {
  const original = (await api.get('/auth/me')).school_name;
  const updated = `${original} (Edited)`;

  await page.goto('/cohorts');
  await page.getByRole('link', { name: 'Your profile' }).click();
  await expect(page).toHaveURL(/\/profile$/);

  const input = page.getByLabel('School name');
  await expect(input).toHaveValue(original);
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  try {
    await input.fill(updated);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.nav-school')).toHaveText(updated);
  } finally {
    await api.put('/account', { school_name: original });
  }
});

test('profile: change password validates fields and submits to /account/password', async ({ page }) => {
  const calls: Array<{ current_password: string; new_password: string }> = [];
  await page.route('**/account/password', async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.current_password === 'wrong-current') {
      await route.fulfill(json(403, { detail: 'Incorrect password' }));
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });

  await page.goto('/profile');
  const current = page.getByLabel('Current password');
  const next = page.getByLabel('New password', { exact: true });
  const confirm = page.getByLabel('Confirm new password');
  const submit = page.getByRole('button', { name: 'Update password' });

  await expect(submit).toBeDisabled();

  // Short password + mismatch
  await current.fill('old-password-123');
  await next.fill('short');
  await confirm.fill('different');
  await submit.click();
  await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  expect(calls).toHaveLength(0);

  // Same as current password
  await next.fill('old-password-123');
  await confirm.fill('old-password-123');
  await submit.click();
  await expect(page.getByText('New password must be different from your current password.')).toBeVisible();
  expect(calls).toHaveLength(0);

  // Wrong current password (403 from server)
  await current.fill('wrong-current');
  await next.fill('new-password-456');
  await confirm.fill('new-password-456');
  await submit.click();
  await expect(page.getByText('Incorrect password.')).toBeVisible();
  expect(calls).toEqual([{ current_password: 'wrong-current', new_password: 'new-password-456' }]);

  // Successful password update
  await current.fill('old-password-123');
  await submit.click();
  await expect(page.getByText('Password updated')).toBeVisible();
  await expect(current).toHaveValue('');
  await expect(next).toHaveValue('');
  await expect(confirm).toHaveValue('');
});

test('profile: delete account modal shows summary, downloads .xlsx backup, and confirms password', async ({ page, seed }) => {
  void seed; // ensures pre-solved cohorts exist for summary counts and export
  await page.route('**/account/delete', async (route) => {
    const { password } = route.request().postDataJSON();
    if (password === 'wrong-pass') {
      await route.fulfill(json(403, { detail: 'Incorrect password' }));
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });

  await page.goto('/profile');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText(/\d+ cohorts?/)).toBeVisible();
  await expect(dlg.getByText(/\d+ students?/)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dlg.getByRole('button', { name: 'Download my data (.xlsx)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');

  const pw = dlg.getByLabel('Enter your password to confirm');
  await pw.fill('wrong-pass');
  await dlg.getByRole('button', { name: 'Delete everything' }).click();
  await expect(dlg.getByText('Incorrect password.')).toBeVisible();

  await pw.fill('correct-pass');
  await dlg.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page).toHaveURL(/\/account-deleted$/);
  await expect(page.getByText('Your account was deleted')).toBeVisible();
});
