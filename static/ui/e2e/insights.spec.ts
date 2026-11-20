import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe('evidence card: evidence ID, suggested edit and who to ask', () => {
  test('a contradicted claim shows the evidence ID the agent tools return, the proposed edit and the people to ask', async ({ page }) => {
    await page.goto('/?module=runbook-byline');
    const first = page.getByTestId('byline-claim').first();
    await expect(first).toContainText('ev_9f2c0e11');
    await expect(first.getByTestId('suggested-edit')).toHaveText(
      'Suggested edit: replace POST /v1/charge with POST /v2/payments. Review it before you change the page.',
    );
    await expect(first.getByTestId('who-to-ask')).toHaveText('Who to ask: Asha Rao (page owner), Ben Ito (last editor)');
    const calls = await page.evaluate(() => window.__pilCalls);
    expect(calls).toContainEqual({ name: 'getPageContacts', payload: { contentId: '123456' } });
  });

  test('verified and no-evidence claims get no edit and no contact line', async ({ page }) => {
    await page.goto('/?module=runbook-byline');
    await expect(page.getByTestId('byline-claim')).toHaveCount(6);
    await expect(page.getByTestId('suggested-edit')).toHaveCount(3);
    await expect(page.getByTestId('who-to-ask')).toHaveCount(3);
    await expect(page.getByTestId('byline-claim').last().getByTestId('suggested-edit')).toHaveCount(0);
  });

  test('the contact line is left out when the page people cannot be read, and not requested without a contradiction', async ({ page }) => {
    await page.goto('/?module=runbook-byline&contacts=none');
    await expect(page.getByTestId('suggested-edit')).toHaveCount(3);
    await expect(page.getByTestId('who-to-ask')).toHaveCount(0);
    await page.goto('/?module=runbook-byline&scenario=no_claims');
    await expect(page.getByText('No claims found on this page.')).toBeVisible();
    const calls = await page.evaluate(() => window.__pilCalls);
    expect(calls?.map((c) => c.name)).not.toContain('getPageContacts');
  });

  test('the macro hover card shows the same lines', async ({ page }) => {
    await page.goto('/?module=runbook-check');
    await page.getByTestId('claim').first().hover();
    const card = page.getByTestId('evidence-card').first();
    await expect(card).toContainText('ev_9f2c0e11');
    await expect(card.getByTestId('suggested-edit')).toContainText('replace POST /v1/charge with POST /v2/payments');
    await expect(card.getByTestId('who-to-ask')).toContainText('Asha Rao (page owner)');
  });
});

test.describe('get started', () => {
  test('first run: three steps and one click saves the demo repository and starts indexing', async ({ page }) => {
    await page.goto('/?module=runbook-settings&repo=none');
    const start = page.getByTestId('get-started');
    await expect(start.getByRole('heading', { level: 2, name: 'Get started' })).toBeVisible();
    await expect(start.getByRole('listitem')).toHaveCount(3);
    await start.getByRole('button', { name: 'Use the demo repository' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Demo repository saved. Indexing started.' })).toBeVisible();
    await expect(page.getByLabel('Repository URL')).toHaveValue('https://github.com/himanshu748/payments-api');
    await expect(page.getByLabel('Branch or tag (optional)')).toHaveValue('main');
    const calls = await page.evaluate(() => window.__pilCalls);
    const save = calls?.find((c) => c.name === 'saveSettings');
    expect(save?.payload).toMatchObject({ repoUrl: 'https://github.com/himanshu748/payments-api', ref: 'main' });
    expect(save?.payload).not.toHaveProperty('token');
    await expect(start.getByRole('button', { name: 'Use the demo repository' })).toHaveCount(0);
    await expect(start).toContainText('Connect a repository (done)');
  });

  test('a saved repository without an index keeps the guide and hides the demo button', async ({ page }) => {
    await page.goto('/?module=runbook-settings&status=indexing');
    const start = page.getByTestId('get-started');
    await expect(start).toContainText('Indexing now.');
    await expect(start.getByRole('button', { name: 'Use the demo repository' })).toHaveCount(0);
  });

  test('once indexed, the guide becomes a short "where to look" note', async ({ page }) => {
    await page.goto('/?module=runbook-settings&status=ready');
    await expect(page.getByTestId('get-started').getByRole('heading', { level: 2, name: 'You are set up' })).toBeVisible();
    await expect(page.getByTestId('get-started')).toContainText('Doc drift');
  });

  for (const theme of ['light', 'dark']) {
    test(`axe finds no violations on first run (${theme})`, async ({ page }) => {
      await page.goto(`/?module=runbook-settings&repo=none&theme=${theme}`);
      await expect(page.getByTestId('get-started')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});

test.describe('space doc drift page', () => {
  test('ranks pages by contradicted claims with counts, citations, evidence IDs and proposed edits', async ({ page }) => {
    await page.goto('/?module=runbook-drift');
    await expect(page.getByRole('heading', { level: 1, name: 'Doc drift in this space' })).toBeVisible();
    const pages = page.getByTestId('drift-page');
    await expect(pages).toHaveCount(3);
    await expect(pages.nth(0)).toContainText('Payments API runbook');
    await expect(pages.nth(0)).toContainText('3 contradicted of 6 claims (50%)');
    await expect(pages.nth(0)).toContainText('src/routes.ts:88');
    await expect(pages.nth(0)).toContainText('ev_9f2c0e11');
    await expect(pages.nth(0)).toContainText('Suggested edit: replace POST /v1/charge with POST /v2/payments.');
    await expect(pages.nth(1)).toContainText('Deploy guide');
    await expect(pages.nth(2)).toContainText('0 contradicted of 4 claims');
    await expect(page.getByTestId('drift-scope')).toContainText('Checked the 5 most recently edited pages, 2 without checkable claims, 1 skipped');
    await expect(page.getByTestId('drift-scope')).toContainText('himanshu748/payments-api@3f2c1a9');
    await expect(page.getByLabel('Space totals')).toContainText('2 of 3 pages with claims have a contradiction');
  });

  test('a page title opens the page, a citation opens the permalink, and the audit only reads', async ({ page }) => {
    await page.goto('/?module=runbook-drift');
    await page.getByRole('button', { name: 'Payments API runbook' }).click();
    expect(await page.evaluate(() => window.__pilNavigations)).toEqual(['/wiki/pages/viewpage.action?pageId=123456']);
    await page.getByTestId('drift-page').first().getByRole('button', { name: /src\/routes\.ts:88/ }).click();
    const opened = await page.evaluate(() => window.__pilRouter);
    expect(String(opened?.[0])).toContain('/blob/');
    const calls = await page.evaluate(() => window.__pilCalls);
    expect(calls?.map((c) => c.name)).toEqual(['auditSpace']);
  });

  test('Run again repeats the audit', async ({ page }) => {
    await page.goto('/?module=runbook-drift');
    await expect(page.getByTestId('drift-page')).toHaveCount(3);
    await page.getByRole('button', { name: 'Run again' }).click();
    await expect(page.getByTestId('drift-page')).toHaveCount(3);
    const calls = await page.evaluate(() => window.__pilCalls);
    expect(calls?.map((c) => c.name)).toEqual(['auditSpace', 'auditSpace']);
  });

  test('a page with more claims than the limit says the rest were not checked', async ({ page }) => {
    await page.goto('/?module=runbook-drift');
    await expect(page.getByText('Only the first claims were checked')).toHaveCount(0);
    await page.goto('/?module=runbook-drift&drift=truncated');
    await expect(page.getByTestId('drift-page').last()).toContainText('0 contradicted of 4 claims. Only the first claims were checked: the page has more than the limit');
  });

  test('empty space, missing repository and failure show a notice and no ranking', async ({ page }) => {
    await page.goto('/?module=runbook-drift&drift=empty');
    await expect(page.getByText('No checkable claims were found in the pages of this space.')).toBeVisible();
    await page.goto('/?module=runbook-drift&drift=no_repo');
    await expect(page.getByRole('alert')).toContainText('No repository is connected yet.');
    await page.goto('/?module=runbook-drift&drift=error');
    await expect(page.getByRole('alert')).toContainText('The space audit failed.');
    await expect(page.getByTestId('drift-page')).toHaveCount(0);
  });

  for (const theme of ['light', 'dark']) {
    test(`axe finds no violations (${theme})`, async ({ page }) => {
      await page.goto(`/?module=runbook-drift&theme=${theme}`);
      await expect(page.getByTestId('drift-page')).toHaveCount(3);
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
