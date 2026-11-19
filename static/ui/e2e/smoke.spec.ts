import { expect, test } from '@playwright/test';

for (const [moduleKey, name] of [
  ['runbook-check', 'Runbook check'],
  ['runbook-byline', 'Runbook check for this page'],
  ['runbook-settings', 'The Page Is Lying settings'],
] as const) {
  test(`renders the ${moduleKey} view`, async ({ page }) => {
    await page.goto(`/?module=${moduleKey}`);
    await expect(page.getByTestId(`view-${moduleKey}`)).toBeVisible();
    if (moduleKey === 'runbook-settings') await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    else await expect(page.getByRole('region', { name })).toBeVisible();
  });
}

test('unknown module shows an alert', async ({ page }) => {
  await page.goto('/?module=nope');
  await expect(page.getByRole('alert')).toContainText('Unknown module');
});
