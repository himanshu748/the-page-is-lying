import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const EXPECTED = [
  { raw: 'POST /v1/charge', verdict: 'contradicted', label: 'Contradicted', style: 'wavy' },
  { raw: 'GET /v2/payments/{id}', verdict: 'verified', label: 'Verified', style: 'solid' },
  { raw: 'STRIPE_KEY', verdict: 'contradicted', label: 'Contradicted', style: 'wavy' },
  { raw: 'npm run db:migrate', verdict: 'verified', label: 'Verified', style: 'solid' },
  { raw: 'payments refund <paymentId> --force', verdict: 'contradicted', label: 'Contradicted', style: 'wavy' },
  { raw: 'ledgerctl reconcile --since 24h', verdict: 'unknown', label: 'No evidence', style: 'dotted' },
];

const open = (page: Page, query = '') => page.goto(`/?module=runbook-check${query}`);

test.describe('macro view', () => {
  test('six demo claims render with icon, label and distinct underline', async ({ page }) => {
    await open(page);
    const claims = page.getByTestId('claim');
    await expect(claims).toHaveCount(6);
    for (const [index, expected] of EXPECTED.entries()) {
      const claim = claims.nth(index);
      await expect(claim).toHaveAttribute('data-verdict', expected.verdict);
      await expect(claim.locator('svg[aria-hidden="true"]')).toHaveCount(1);
      await expect(claim.locator('.claim-label')).toHaveText(expected.label);
      await expect(claim.locator('.claim-text')).toContainText(expected.raw);
      const style = await claim.locator('.claim-text').evaluate((el) => getComputedStyle(el).textDecorationStyle);
      expect(style).toBe(expected.style);
    }
  });

  test('header shows counts, repo and short SHA, with no Rovo button when Rovo is off', async ({ page }) => {
    await open(page);
    const counts = page.getByRole('list', { name: 'Claims by status' });
    await expect(counts).toContainText('2 Verified');
    await expect(counts).toContainText('3 Contradicted');
    await expect(counts).toContainText('1 No evidence');
    await expect(page.getByText('himanshu748/payments-api@3f2c1a9')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask Runbook checker' })).toHaveCount(0);
  });

  test('Ask Runbook checker opens Rovo with the forge agent when enabled', async ({ page }) => {
    await open(page, '&rovo=1');
    await page.getByRole('button', { name: 'Ask Runbook checker' }).click();
    const calls = await page.evaluate(() => window.__pilRovo);
    expect(calls).toEqual([{ type: 'forge', agentKey: 'runbook-checker', agentName: 'Runbook checker', prompt: 'Is this page still true?' }]);
  });

  test('hover shows the evidence card with src/routes.ts:88 and leaving hides it', async ({ page }) => {
    await open(page);
    const card = page.getByTestId('evidence-card').first();
    await expect(card).toBeHidden();
    await page.getByTestId('claim').first().hover();
    await expect(card).toBeVisible();
    await expect(card).toContainText('src/routes.ts:88');
    await expect(card).toContainText('Contradicted by code: no route matches POST /v1/charge.');
    await expect(card).toContainText("router.post('/v2/payments', createPayment);");
    await expect(card).toContainText('himanshu748/payments-api@3f2c1a9');
    await expect(card).toContainText('2026-12-01 10:00 UTC');
    await page.mouse.move(600, 600);
    await expect(card).toBeHidden();
  });

  test('card stays reachable by pointer and opens the permalink with router.open', async ({ page }) => {
    await open(page);
    await page.getByTestId('claim').first().hover();
    await page.getByRole('button', { name: 'Open src/routes.ts line 88 on GitHub' }).click();
    const opened = await page.evaluate(() => window.__pilRouter);
    expect(opened).toEqual(['https://github.com/himanshu748/payments-api/blob/3f2c1a9d5e7b8c0a1f2e3d4c5b6a79881234abcd/src/routes.ts#L88']);
  });

  test('keyboard focus shows the card, Escape closes it and keeps focus on the claim', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('claim')).toHaveCount(6);
    const first = page.getByTestId('claim').first();
    await first.focus();
    const card = page.getByTestId('evidence-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('src/routes.ts:88');
    await expect(first).toHaveAttribute('aria-describedby', /.+/);
    const describedBy = await first.getAttribute('aria-describedby');
    expect(await page.locator(`[id="${describedBy}"]`).count()).toBe(1);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(first).toBeFocused();
  });

  test('blur closes the card', async ({ page }) => {
    await open(page);
    const second = page.getByTestId('claim').nth(1);
    await page.getByTestId('claim').first().focus();
    await expect(page.getByTestId('evidence-card').first()).toBeVisible();
    await second.focus();
    await expect(page.getByTestId('evidence-card').first()).toBeHidden();
    await expect(page.getByTestId('evidence-card').nth(1)).toBeVisible();
  });

  test('unknown claim card shows the coverage note and no Jira button', async ({ page }) => {
    await open(page);
    await page.getByTestId('claim').nth(5).focus();
    const card = page.getByTestId('evidence-card').nth(5);
    await expect(card).toContainText('No evidence found');
    await expect(card).toContainText('Coverage for CLI commands in this index: partial.');
    await expect(card).toContainText('This is not a confirmation that the claim holds.');
    await expect(card.getByRole('button', { name: 'Draft Jira task' })).toHaveCount(0);
  });

  test('card flips above when the claim is near the bottom of a short frame', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 330 });
    await open(page);
    await page.getByTestId('claim').nth(4).focus();
    const card = page.getByTestId('evidence-card').nth(4);
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? -1) >= 0).toBe(true);
    expect((box?.y ?? 0) + (box?.height ?? 0) <= 330).toBe(true);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe finds no violations in the ${theme} theme (card open)`, async ({ page }) => {
      await open(page, `&theme=${theme}`);
      await expect(page.getByTestId('claim')).toHaveCount(6);
      await page.getByTestId('claim').first().focus();
      await expect(page.getByTestId('evidence-card').first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }

  test('keyboard-only path: reach a claim, its card controls, the Jira draft and back', async ({ page }) => {
    await open(page, '&jira=1');
    await expect(page.getByTestId('claim')).toHaveCount(6);
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('claim').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Open src/routes.ts line 88 on GitHub' })).toBeFocused();
    await page.keyboard.press('Tab');
    const draft = page.getByTestId('evidence-card').first().getByRole('button', { name: 'Draft Jira task' });
    await expect(draft).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Draft Jira task' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('claim').first()).toBeFocused();
  });
});

test.describe('states', () => {
  test('indexing shows a notice and the plain body', async ({ page }) => {
    await open(page, '&scenario=indexing');
    await expect(page.getByText('Indexing the repository.')).toBeVisible();
    await expect(page.getByTestId('claim')).toHaveCount(0);
    // The body still shows as plain text while indexing.
    await expect(page.getByText('To take a payment, call')).toBeVisible();
  });

  test('indexing polls and then shows results', async ({ page }) => {
    await open(page, '&scenario=indexing-then-ready');
    await expect(page.getByText('Indexing the repository.')).toBeVisible();
    await expect(page.getByTestId('claim')).toHaveCount(6, { timeout: 8000 });
    await expect(page.getByText('Indexing the repository.')).toHaveCount(0);
  });

  test('stale index shows a warning and still shows claims', async ({ page }) => {
    await open(page, '&scenario=stale');
    await expect(page.getByText('Index may be stale', { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId('claim')).toHaveCount(6);
  });

  test('rate limited without a report shows no verdicts', async ({ page }) => {
    await open(page, '&scenario=rate_limited');
    await expect(page.getByText('GitHub rate limit reached')).toBeVisible();
    await expect(page.getByText('no claim counts as verified')).toBeVisible();
    await expect(page.getByTestId('claim')).toHaveCount(0);
  });

  test('rate limited with an older index keeps showing it', async ({ page }) => {
    await open(page, '&scenario=rate_limited_stale');
    await expect(page.getByText('Showing the last index.')).toBeVisible();
    await expect(page.getByTestId('claim')).toHaveCount(6);
  });

  test('repository not found', async ({ page }) => {
    await open(page, '&scenario=repo_not_found');
    await expect(page.getByRole('alert')).toContainText('Repository not found');
  });

  test('no repository configured', async ({ page }) => {
    await open(page, '&scenario=no_repo');
    await expect(page.getByText('No repository is configured.')).toBeVisible();
  });

  test('no claims found', async ({ page }) => {
    await open(page, '&scenario=no_claims');
    await expect(page.getByText('No claims found in this section.', { exact: false })).toBeVisible();
    await expect(page.getByText('Nothing checkable here.')).toBeVisible();
  });

  test('error', async ({ page }) => {
    await open(page, '&scenario=error');
    await expect(page.getByRole('alert')).toContainText('The check failed.');
  });

  for (const scenario of ['indexing', 'stale', 'rate_limited', 'repo_not_found', 'no_repo', 'no_claims', 'error']) {
    test(`axe finds no violations in the ${scenario} state (dark)`, async ({ page }) => {
      await open(page, `&scenario=${scenario}&theme=dark`);
      await expect(page.getByTestId('view-runbook-check')).toBeVisible();
      await expect(page.locator('[role="status"], [role="alert"], .notice, .bar').first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
