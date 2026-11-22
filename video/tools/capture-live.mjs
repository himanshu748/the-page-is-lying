#!/usr/bin/env node
// Records the live runbook page from a Chrome that is already signed in to the site (CDP), as a
// sequence of real screenshots encoded to a video, and writes the 1920-wide boxes of the header
// chips and claims so the overlay rings in s03/s07 line up.
//   node video/tools/capture-live.mjs <page url> <out.mp4> <seconds> [height=720] [cdp=http://localhost:29229]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url, out, seconds = '28', height = '720', cdp = 'http://localhost:29229'] = process.argv.slice(2);
const W = 1280, H = Number(height), K = 1920 / W;
const browser = await chromium.connectOverCDP(cdp);
const page = await browser.contexts()[0].newPage();
const session = await page.context().newCDPSession(page);
await session.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const frame = page.frameLocator('iframe[data-testid="hosted-resources-iframe"]').first();
const claims = frame.getByTestId('claim');
await claims.nth(5).waitFor({ timeout: 90000 });
await page.waitForTimeout(4000);
// The side navigation opens scrolled to the current page; show it from the top.
await page.evaluate(() => {
  for (const el of document.querySelectorAll('nav, nav *, [data-testid*="side-nav"] *')) if (el.scrollTop > 0) el.scrollTop = 0;
});
await page.mouse.move(640, 400);
await page.waitForTimeout(1500);

const boxes = {};
const box = async (name, locator) => {
  const b = await locator.boundingBox();
  if (b) boxes[name] = { left: Math.round(b.x * K) - 6, top: Math.round(b.y * K) - 5, width: Math.round(b.width * K) + 12, height: Math.round(b.height * K) + 10 };
};
const view = frame.getByTestId('view-runbook-check');
await box('verified', view.getByText(/^\D*\d+\s+Verified$/).first());
await box('contradicted', view.getByText(/^\D*\d+\s+Contradicted$/).first());
await box('unknown', view.getByText(/^\D*\d+\s+No evidence$/).first());
await box('repo', view.getByText(/^himanshu748\/[\w-]+@[0-9a-f]{7}$/).first());
for (let i = 0; i < 6; i += 1) await box(`claim${i + 1}`, claims.nth(i));
console.log('header:', (await view.innerText()).replace(/\s+/g, ' ').slice(0, 400));

const dir = mkdtempSync(join(tmpdir(), 'pil-live-'));
const fps = 2, n = Math.ceil(Number(seconds) * fps);
for (let i = 0; i < n; i += 1) {
  const t = Date.now();
  await page.screenshot({ path: join(dir, `f${String(i).padStart(4, '0')}.png`) });
  await page.waitForTimeout(Math.max(0, 1000 / fps - (Date.now() - t)));
}
await page.close();
await browser.close();
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(dir, 'f%04d.png'), '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out]);
writeFileSync(out.replace(/\.mp4$/, '.boxes.json'), `${JSON.stringify(boxes, null, 2)}\n`);
writeFileSync(out.replace(/\.mp4$/, '.png'), execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-ss', '5', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-']));
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(boxes));
