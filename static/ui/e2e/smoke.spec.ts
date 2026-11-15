import { expect, test } from '@playwright/test';

for (const [moduleKey, heading] of [
  ['runbook-check', 'Runbook check'],
  ['runbook-byline', 'Runbook check (page)'],
  ['runbook-settings', 'The Page Is Lying settings'],
] as const) {
  test(`renders the ${moduleKey} placeholder`, async ({ page }) => {
    await page.goto(`/?module=${moduleKey}`);
    await expect(page.getByTestId(`view-${moduleKey}`)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  });
}
