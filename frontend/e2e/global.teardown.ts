import { test as teardown } from '@playwright/test';
import { apiClient } from './support/api';
import { AUTH_STATE, PREFIX } from './support/env';

teardown.use({ storageState: AUTH_STATE });

// Deletes every cohort the suite created (including leftovers from interrupted runs).
teardown('delete e2e cohorts', async ({ page }) => {
  const api = apiClient(page.request);
  const { cohorts } = await api.get<{ cohorts: { id: string; name: string }[] }>('/cohorts');
  for (const c of cohorts.filter((c) => c.name.startsWith(PREFIX))) await api.del(`/cohorts/${c.id}`);
});
