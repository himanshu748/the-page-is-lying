import { expect, test } from '@playwright/test';

test('the local demo checks the bundled code and changes only the corrected route', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local-demo.html');
  const resources = page.getByRole('navigation', { name: 'Forge demo resources' });
  await expect(resources.getByRole('link', { name: 'Set up in Confluence' })).toHaveAttribute('href',
    'https://github.com/himanshu748/the-page-is-lying/blob/main/docs/setup.md#judge-setup');
  await expect(resources.getByRole('link', { name: 'Watch the Forge and Rovo demo' })).toHaveAttribute('href',
    'https://www.youtube.com/watch?v=GAsxA1YAr-4');
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

test('the local demo distinguishes a frontend fallback from a declared API route', async ({ page }) => {
  await page.goto('/local-demo.html');
  await page.getByLabel('Runbook example').selectOption('catch-all');
  const results = page.getByRole('listitem');
  const removed = results.filter({ has: page.getByRole('heading', { name: 'GET /v1/refunds/123' }) });
  const declared = results.filter({ has: page.getByRole('heading', { name: 'GET /v2/refunds/{id}' }) });
  await expect(removed).toContainText('No evidence');
  await expect(removed).toContainText('a catch-all route matches the path');
  await expect(removed).toContainText('server.js:5');
  await expect(removed.getByRole('link', { name: 'server.js:5' })).toHaveAttribute('href',
    'https://github.com/himanshu748/the-page-is-lying/blob/49f12f23d6455f6243fac5980db1f034cf502eea/demo/fixtures/catch-all/server.js#L5');
  await expect(declared).toContainText('Verified');
  await expect(declared).toContainText('server.js:4');
});

test('a judge can submit an independent claim and follow its citation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local-demo.html');
  const check = page.getByRole('region', { name: 'Check your own claim' });
  const claim = check.getByLabel('Claim from a runbook');
  const submit = check.getByRole('button', { name: 'Check claim' });
  await expect(submit).toBeDisabled();
  await claim.fill('GET /health');
  await claim.press('Enter');
  await expect(check.getByRole('listitem')).toContainText('Verified');
  await expect(check.getByRole('link', { name: 'src/routes.ts:84' })).toHaveAttribute('href',
    'https://github.com/himanshu748/payments-api-demo/blob/44c8112e1bc0f3be63fe45fbcb70bfaf6bfb03a5/src/routes.ts#L84');

  await claim.fill('POST /v1/charge');
  await submit.click();
  await expect(check.getByRole('listitem')).toContainText('Contradicted');
  await expect(check.getByRole('link', { name: 'src/routes.ts:88' })).toBeVisible();

  await claim.fill('Can you tell me a story?');
  await submit.click();
  await expect(check).toContainText('No checkable claim found.');
  await expect(check.getByRole('listitem')).toHaveCount(0);
});
