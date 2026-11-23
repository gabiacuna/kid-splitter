import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { apiClient, type Api } from './api';
import { SEED_FILE } from './env';

export interface Seed {
  /** 24 students, 12 boys / 12 girls, 3 classes, gender balance on, soft together-pairs; solved. */
  full: string;
  /** 20 students, 6 boys / 6 girls / 8 unknown, 3 classes; solved. */
  partial: string;
  /** 10 students, no gender data, 2 classes, soft together-pairs; solved. */
  noGender: string;
}

/**
 * `api`: JSON client sharing the logged-in session.
 * `seed`: ids of the pre-solved cohorts created by global.setup.ts.
 * `pageErrors` (auto): fails a test that logs a page error or console error.
 */
export const test = base.extend<{ api: Api; seed: Seed; pageErrors: string[] }>({
  api: async ({ page }, use) => use(apiClient(page.request)),
  seed: async ({}, use) => use(JSON.parse(readFileSync(SEED_FILE, 'utf8'))),
  pageErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await use(errors);
    expect(errors, 'page/console errors').toEqual([]);
  }, { auto: true }],
});

export { expect };
