import { test as setup, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { apiClient, fakeStudents } from './support/api';
import { AUTH_STATE, SEED_FILE, credentials } from './support/env';

// Logs in once, saves the session, and seeds the solved cohorts specs share.
// This is the only place the suite solves (3 solves per run; the API allows 10/hour).
setup('log in and seed solved cohorts', async ({ page }) => {
  const { email, password } = credentials();
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  // The app defaults to Spanish; the suite's selectors are English, so pin the saved session to English.
  await page.evaluate(() => localStorage.setItem('lang', 'en'));
  mkdirSync(path.dirname(AUTH_STATE), { recursive: true });
  await page.context().storageState({ path: AUTH_STATE });

  const api = apiClient(page.request);

  const full = await api.createCohort('solutions full', { balance_gender: true });
  const fullIds = await api.addStudents(full.id, fakeStudents(24, (i) => (i < 12 ? 'boy' : 'girl')));
  for (const [a, b] of [[0, 1], [2, 3], [4, 5]]) await api.together(full.id, fullIds[a], fullIds[b]);

  const partial = await api.createCohort('solutions partial', { balance_gender: true });
  await api.addStudents(partial.id, fakeStudents(20, (i) => (i < 6 ? 'boy' : i < 12 ? 'girl' : null)));

  const noGender = await api.createCohort('no gender', { num_classes: 2 });
  const ngIds = await api.addStudents(noGender.id, fakeStudents(10));
  for (const [a, b] of [[0, 1], [2, 3]]) await api.together(noGender.id, ngIds[a], ngIds[b]);

  await api.post(`/cohorts/${full.id}/solve`, { num_classes: 3 });
  await api.post(`/cohorts/${partial.id}/solve`, { num_classes: 3 });
  await api.post(`/cohorts/${noGender.id}/solve`, { num_classes: 2 });

  writeFileSync(SEED_FILE, JSON.stringify({ full: full.id, partial: partial.id, noGender: noGender.id }));
  expect((await api.get(`/cohorts/${full.id}/solutions`)).length).toBe(3);
});
