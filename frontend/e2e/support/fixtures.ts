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
export const test = base.extend<{ api: Api; seed: Seed; pageErrors: string[]; allowHttpErrors: boolean }>({
  /** Set via test.use({ allowHttpErrors: true }) in specs that provoke 4xx on purpose
   *  (logged-out pages, wrong passwords). JS errors still fail the test. */
  allowHttpErrors: [false, { option: true }],
  api: async ({ page }, provide) => provide(apiClient(page.request)),
  seed: async ({}, provide) => provide(JSON.parse(readFileSync(SEED_FILE, 'utf8'))),
  pageErrors: [async ({ page, allowHttpErrors }, provide) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (allowHttpErrors && /^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
      errors.push(`console: ${m.text()}`);
    });
    await provide(errors);
    expect(errors, 'page/console errors').toEqual([]);
  }, { auto: true }],
});

export { expect };
