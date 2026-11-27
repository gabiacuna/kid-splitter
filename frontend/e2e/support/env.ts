import { readFileSync } from 'node:fs';
import path from 'node:path';

export const APP_URL = process.env.E2E_APP_URL ?? 'http://localhost:5173';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api';

const DIR = path.dirname(new URL(import.meta.url).pathname);
export const E2E_DIR = path.resolve(DIR, '..');
export const AUTH_STATE = path.join(E2E_DIR, '.auth', 'state.json');
export const SEED_FILE = path.join(E2E_DIR, '.auth', 'seed.json');

/** Every cohort the suite creates starts with this, so teardown can find and delete them. */
export const PREFIX = '[e2e]';

/** Credentials: E2E_EMAIL / E2E_PASSWORD, or KEY=value lines in the file named by E2E_ENV_FILE
 *  (default e2e/.env, gitignored). Never commit real credentials. */
export function credentials(): { email: string; password: string } {
  const file = process.env.E2E_ENV_FILE ?? path.join(E2E_DIR, '.env');
  let fromFile: Record<string, string> = {};
  try {
    fromFile = Object.fromEntries(
      readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch { /* no file — rely on env vars */ }
  const email = process.env.E2E_EMAIL ?? fromFile.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD ?? fromFile.E2E_PASSWORD;
  if (!email || !password) throw new Error('Set E2E_EMAIL and E2E_PASSWORD (env or e2e/.env) — see e2e/README.md');
  return { email, password };
}
