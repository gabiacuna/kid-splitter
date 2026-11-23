import type { APIRequestContext } from '@playwright/test';
import { API_URL, PREFIX } from './env';

/** Thin JSON client for seeding/inspecting data through the real API (uses the page's auth cookies). */
export function apiClient(request: APIRequestContext) {
  async function call<T = any>(method: string, path: string, data?: unknown): Promise<T> {
    const r = await request.fetch(`${API_URL}${path}`, { method, data });
    if (!r.ok()) throw new Error(`${method} ${path} -> ${r.status()} ${await r.text()}`);
    return (r.status() === 204 ? null : await r.json()) as T;
  }
  return {
    get: <T = any>(p: string) => call<T>('GET', p),
    post: <T = any>(p: string, d?: unknown) => call<T>('POST', p, d),
    put: <T = any>(p: string, d?: unknown) => call<T>('PUT', p, d),
    del: (p: string) => call('DELETE', p),

    async createCohort(name: string, opts: { num_classes?: number; balance_gender?: boolean } = {}) {
      return call<{ id: string; name: string }>('POST', '/cohorts', {
        name: `${PREFIX} ${name}`, num_classes: opts.num_classes ?? 3, balance_gender: opts.balance_gender ?? false,
      });
    },
    async addStudents(cohortId: string, students: { first_name: string; last_name: string; gender?: 'boy' | 'girl' | null }[]) {
      const ids: string[] = [];
      for (const s of students) ids.push((await call<{ id: string }>('POST', `/cohorts/${cohortId}/students`, s)).id);
      return ids;
    },
    async together(cohortId: string, a: string, b: string, opts: { is_hard?: boolean; weight?: number; type?: 'together' | 'separate' } = {}) {
      return call<{ id: string }>('POST', `/cohorts/${cohortId}/constraints/binary`, {
        student_a_id: a, student_b_id: b, type: opts.type ?? 'together', is_hard: opts.is_hard ?? false, weight: opts.weight ?? 2,
      });
    },
  };
}
export type Api = ReturnType<typeof apiClient>;

/** Deterministic fake names: "Kid0 TestA", "Kid1 TestB", … */
export const fakeStudents = (n: number, gender: (i: number) => 'boy' | 'girl' | null = () => null) =>
  Array.from({ length: n }, (_, i) => ({ first_name: `Kid${i}`, last_name: `Test${String.fromCharCode(65 + (i % 26))}`, gender: gender(i) }));
