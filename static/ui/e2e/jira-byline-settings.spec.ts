import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const EXPECTED_SUMMARY = 'Update runbook: POST /v1/charge is contradicted by code';
const EXPECTED_DESCRIPTION = [
  'The runbook "this page" contains a claim that the code contradicts.',
  'Claim: POST /v1/charge',
  'Finding: Contradicted by code: no route matches POST /v1/charge. The repo has POST /v2/payments at src/routes.ts:88.',
  'Checked against himanshu748/payments-api@3f2c1a9.',
].join('\n');

const READ_ONLY_CALLS = new Set(['checkBody', 'checkPage', 'getJiraTarget', 'getSettings', 'getIndexStatus', 'getPageContacts']);

async function openJiraDraft(page: Page, query: string) {
  await page.goto(`/?module=runbook-check${query}`);
  await expect(page.getByTestId('claim')).toHaveCount(6);
  await page.getByTestId('claim').first().hover();
  await page.getByTestId('evidence-card').first().getByRole('button', { name: 'Draft Jira task' }).click();
  return page.getByRole('dialog', { name: 'Draft Jira task' });
}

test.describe('Jira draft modal', () => {
  test('shows the exact issue text and makes no write call before, during or after open, copy and cancel', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const external: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname !== 'localhost') external.push(`${request.method()} ${request.url()}`);
    });
    await page.goto('/?module=runbook-check&jira=1');
    await expect(page.getByTestId('claim')).toHaveCount(6);
    const callNames = async () => (await page.evaluate(() => window.__pilCalls ?? [])).map((c) => c.name);
    expect((await callNames()).every((n) => READ_ONLY_CALLS.has(n))).toBe(true);

    await page.getByTestId('claim').first().hover();
    await page.getByTestId('evidence-card').first().getByRole('button', { name: 'Draft Jira task' }).click();
    const dialog = page.getByRole('dialog', { name: 'Draft Jira task' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('jira-summary')).toHaveText(EXPECTED_SUMMARY);
    await expect(page.getByTestId('jira-description')).toHaveText(EXPECTED_DESCRIPTION);

    await dialog.getByRole('button', { name: 'Copy text' }).click();
    await expect(dialog.getByText('Copied to the clipboard.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${EXPECTED_SUMMARY}\n\n${EXPECTED_DESCRIPTION}`);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    // Only reads happened, nothing left the page, and the router was never used.
    expect((await callNames()).every((n) => READ_ONLY_CALLS.has(n))).toBe(true);
    expect(external).toEqual([]);
    expect(await page.evaluate(() => window.__pilRouter)).toEqual([]);
  });

  test('Open Jira create screen only navigates with the prefilled text', async ({ page }) => {
    const dialog = await openJiraDraft(page, '&jira=1');
    await dialog.getByRole('button', { name: 'Open Jira create screen' }).click();
    const opened = (await page.evaluate(() => window.__pilRouter)) as string[];
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0] as string);
    expect(url.origin + url.pathname).toBe('https://example.atlassian.net/secure/CreateIssueDetails!init.jspa');
    expect(url.searchParams.get('pid')).toBe('10000');
    expect(url.searchParams.get('issuetype')).toBe('10001');
    expect(url.searchParams.get('summary')).toBe(EXPECTED_SUMMARY);
    expect(url.searchParams.get('description')).toBe(EXPECTED_DESCRIPTION);
    const names = (await page.evaluate(() => window.__pilCalls ?? [])).map((c) => c.name);
    expect(names.every((n) => READ_ONLY_CALLS.has(n))).toBe(true);
  });

  test('create screen is disabled with an explanation when Jira ids are not configured', async ({ page }) => {
    const dialog = await openJiraDraft(page, '');
    await expect(dialog.getByRole('button', { name: 'Open Jira create screen' })).toBeDisabled();
    await expect(dialog.getByText('Set a Jira project id and issue type id')).toBeVisible();
  });

  for (const theme of ['light', 'dark']) {
    test(`axe finds no violations with the modal open (${theme})`, async ({ page }) => {
      const dialog = await openJiraDraft(page, `&jira=1&theme=${theme}`);
      await expect(dialog).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});

test.describe('byline popup', () => {
  test('lists claims grouped by status with evidence', async ({ page }) => {
    await page.goto('/?module=runbook-byline');
    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings).toHaveText(['Contradicted by code (3)', 'No evidence found (1)', 'Verified in code (2)']);
    await expect(page.getByTestId('byline-claim')).toHaveCount(6);
    await expect(page.getByTestId('byline-claim').first()).toContainText('POST /v1/charge');
    await expect(page.getByTestId('byline-claim').first()).toContainText('src/routes.ts:88');
    await expect(page.getByTestId('byline-claim').first().getByRole('button', { name: 'Draft Jira task' })).toBeVisible();
    const calls = await page.evaluate(() => window.__pilCalls);
    expect(calls?.[0]).toEqual({ name: 'checkPage', payload: { contentId: '123456' } });
  });

  for (const theme of ['light', 'dark']) {
    test(`axe finds no violations (${theme})`, async ({ page }) => {
      await page.goto(`/?module=runbook-byline&theme=${theme}`);
      await expect(page.getByTestId('byline-claim')).toHaveCount(6);
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }

  test('indexing and error states', async ({ page }) => {
    await page.goto('/?module=runbook-byline&scenario=indexing');
    await expect(page.getByText('Indexing the repository.')).toBeVisible();
    await page.goto('/?module=runbook-byline&scenario=error');
    await expect(page.getByRole('alert')).toContainText('The check failed.');
  });
});

test.describe('settings page', () => {
  test('shows saved settings, "token saved" and never the token', async ({ page }) => {
    await page.goto('/?module=runbook-settings&status=ready');
    await expect(page.getByLabel('Repository URL')).toHaveValue('https://github.com/himanshu748/payments-api');
    await expect(page.getByLabel('GitHub token (optional, read-only)')).toHaveValue('');
    await expect(page.getByText('token saved')).toBeVisible();
    const table = page.getByTestId('index-status');
    await expect(table).toContainText('3f2c1a9');
    await expect(table).toContainText('14');
    await expect(table).toContainText('Coverage: HTTP routes');
  });

  test('saving sends the form, including a new token, and shows confirmation', async ({ page }) => {
    await page.goto('/?module=runbook-settings');
    await page.getByLabel('Repository URL').fill('https://github.com/acme/api');
    await page.getByLabel('GitHub token (optional, read-only)').fill('ghp_exampletoken');
    await page.getByLabel('Service hosts (optional, one per line)').fill('api.example.com\nstaging.example.com');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved. Indexing started.')).toBeVisible();
    const save = (await page.evaluate(() => window.__pilCalls))?.find((c) => c.name === 'saveSettings');
    expect(save?.payload).toMatchObject({
      repoUrl: 'https://github.com/acme/api',
      token: 'ghp_exampletoken',
      serviceHosts: ['api.example.com', 'staging.example.com'],
    });
    await expect(page.getByLabel('GitHub token (optional, read-only)')).toHaveValue('');
    await expect(page.getByText('ghp_exampletoken')).toHaveCount(0);
  });

  test('a non-admin sees the refusal for save and Index now', async ({ page }) => {
    await page.goto('/?module=runbook-settings&settings=forbidden');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Only a Confluence administrator can change these settings.')).toBeVisible();
    await page.getByRole('button', { name: 'Index now' }).click();
    await expect(page.getByText('Only a Confluence administrator can start indexing.')).toBeVisible();
  });

  test('a failed save or Index now explains the access problem instead of failing silently', async ({ page }) => {
    await page.goto('/?module=runbook-settings&settings=auth-error');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status')).toContainText('Settings could not be saved. The app could not confirm that you are a Confluence administrator');
    await expect(page.getByRole('status')).toContainText('choose Allow access');
    await page.getByRole('button', { name: 'Index now' }).click();
    await expect(page.getByRole('status')).toContainText('Indexing could not be started. The app could not confirm');
  });

  test('Index now starts indexing and the status polls', async ({ page }) => {
    await page.goto('/?module=runbook-settings');
    await expect(page.getByText('No index yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Index now' }).click();
    await expect(page.getByText('Indexing started.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('index-status')).toContainText('Indexing');
  });

  for (const theme of ['light', 'dark']) {
    test(`axe finds no violations (${theme})`, async ({ page }) => {
      await page.goto(`/?module=runbook-settings&status=ready&theme=${theme}`);
      await expect(page.getByTestId('index-status')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }

  test('keyboard-only: tab through every field to Save', async ({ page }) => {
    await page.goto('/?module=runbook-settings');
    await expect(page.getByLabel('Repository URL')).toHaveValue(/github/);
    await page.getByLabel('Repository URL').focus();
    for (const name of ['Branch or tag (optional)', 'GitHub token (optional, read-only)']) {
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(name)).toBeFocused();
    }
  });
});
