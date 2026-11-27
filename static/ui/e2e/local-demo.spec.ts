import { expect, test } from '@playwright/test';

test('the local demo checks the bundled code and changes only the corrected route', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local-demo.html');
  const counts = page.getByRole('list', { name: 'Claims by status' });
  const route = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'POST /v1/charge' }) });
  await expect(counts.getByRole('listitem')).toHaveText(['2 Verified', '3 Contradicted', '1 No evidence']);
  await expect(route).toContainText('src/routes.ts:88');
  await expect(route).toContainText("router.post('/v2/payments', createPayment);");

  await page.getByRole('button', { name: 'Apply route correction' }).click();
  await expect(counts.getByRole('listitem')).toHaveText(['3 Verified', '2 Contradicted', '1 No evidence']);
  const corrected = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'POST /v2/payments' }) });
  await expect(corrected).toContainText('Verified');
  await expect(corrected).toContainText('src/routes.ts:88');

  await page.getByRole('button', { name: 'Restore original runbook' }).click();
  await expect(route).toContainText('Contradicted');
  expect(await page.locator('.local-demo').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
