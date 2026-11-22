#!/usr/bin/env node
// Captures the evidence card and the Jira draft from the local test build (the e2e build of the
// macro UI with live values, see testbuild/). These shots are labelled "local test build, same UI"
// in the video. Run from the repo root after `npm install` there:  node video/tools/capture-testbuild.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = fileURLToPath(new URL('../assets/testbuild/', import.meta.url));
mkdirSync(out, { recursive: true });

const server = await createServer({ configFile: `${here}testbuild/vite.config.ts`, logLevel: 'warn' });
await server.listen();
const base = 'http://localhost:4174/?module=runbook-check&rovo=1';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 860, height: 520 }, deviceScaleFactor: 2 });
  const shot = (name) => page.screenshot({ path: `${out}${name}.png` });
  // CSS-pixel boxes of the elements the video points at, so overlays line up with the shots.
  const boxes = {};
  const box = async (name, locator) => {
    const b = await locator.boundingBox();
    if (b) boxes[name] = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v)]));
  };
  const claims = page.getByTestId('claim');
  const firstCard = page.getByTestId('evidence-card').first();

  await page.goto(base);
  await claims.nth(5).waitFor();
  await shot('tb-claims');

  await claims.first().hover();
  await firstCard.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await shot('tb-hover-card');
  await box('claim1', claims.first());
  await box('card', firstCard);
  await box('permalink', firstCard.getByRole('button', { name: /^src\/routes\.ts:88/ }));
  await box('statement', firstCard.getByText('Contradicted by code: no route matches', { exact: false }));

  await page.mouse.move(850, 510);
  await firstCard.waitFor({ state: 'hidden' });
  await page.goto(base);
  await claims.nth(5).waitFor();
  await page.keyboard.press('Tab');
  if (!(await page.getByRole('button', { name: 'Ask Runbook checker' }).evaluate((el) => el === document.activeElement).catch(() => false))) {
    // first Tab already on the claim
  } else {
    await page.keyboard.press('Tab');
  }
  await firstCard.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await shot('tb-focus-card');

  await page.keyboard.press('Escape');
  await firstCard.waitFor({ state: 'hidden' });
  await shot('tb-escape');

  await page.goto(`${base}&jira=1`);
  await claims.nth(5).waitFor();
  await claims.first().hover();
  await box('draftJira', firstCard.getByRole('button', { name: 'Draft Jira task' }));
  await firstCard.getByRole('button', { name: 'Draft Jira task' }).click();
  await page.getByRole('dialog', { name: 'Draft Jira task' }).waitFor();
  await page.waitForTimeout(300);
  await shot('tb-jira');
  const dialog = page.getByRole('dialog', { name: 'Draft Jira task' });
  await box('dialog', dialog);
  await box('jiraSummary', page.getByTestId('jira-summary'));
  await box('jiraDescription', page.getByTestId('jira-description'));
  await box('openJira', dialog.getByRole('button', { name: 'Open Jira create screen' }));
  await box('nothingCreated', dialog.getByText('Nothing is created from here', { exact: false }));
  console.log('summary:', await page.getByTestId('jira-summary').textContent());
  console.log('description:', await page.getByTestId('jira-description').textContent());

  // Settings page with the saved repository and the index the live site reported (commit 44c8112).
  const settingsPage = await browser.newPage({ viewport: { width: 860, height: 900 }, deviceScaleFactor: 2 });
  await settingsPage.addInitScript(() => {
    const settings = { repoUrl: 'https://github.com/himanshu748/payments-api-demo', ref: 'main', serviceHosts: [], jiraProjectId: '', jiraIssueTypeId: '', tokenSaved: false };
    const status = {
      state: 'ready', ref: 'main', sha: '44c8112e1bc0f3be63fe45fbcb70bfaf6bfb03a5', indexedAt: '2026-11-22T19:07:47Z',
      filesIndexed: 9, filesSkipped: 1, truncated: false,
      coverage: { routes: 'complete', env: 'complete', cli: 'complete', config: 'none', files: 'complete', packages: 'complete' },
    };
    window.__pilInvoke = (name) => (name === 'getSettings' ? settings : name === 'getIndexStatus' ? status : null);
  });
  await settingsPage.goto('http://localhost:4174/?module=runbook-settings');
  await settingsPage.getByTestId('index-status').waitFor();
  await settingsPage.waitForTimeout(300);
  await settingsPage.screenshot({ path: `${out}tb-settings.png`, fullPage: true });
  await box('settingsRepo', settingsPage.getByLabel('Repository URL'));
  await box('settingsStatus', settingsPage.getByTestId('index-status'));
  await box('settingsCommit', settingsPage.getByTestId('index-status').getByRole('row', { name: /Commit/ }));
  writeFileSync(`${out}boxes.json`, `${JSON.stringify(boxes, null, 2)}\n`);
} finally {
  await browser.close();
  await server.close();
}
