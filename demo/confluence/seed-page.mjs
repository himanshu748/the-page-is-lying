#!/usr/bin/env node
// One-off local script. Creates the "Payments API runbook" page on the demo site via Confluence REST v2.
// Run it yourself, outside the app (the app never writes pages). It reads the API token from a file
// and never prints it.
//
//   ATLASSIAN_EMAIL=you@example.com ATLASSIAN_TOKEN_FILE=/path/to/token \
//     node demo/confluence/seed-page.mjs [--plain] [--fixed] [--space KEY]
//
// --plain  create the page with the runbook text only (no Runbook check macro); insert the macro by hand.
// --fixed  use the fixed page (claim 1 is POST /v2/payments).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = process.env.CONFLUENCE_SITE ?? 'https://one-atlas-obka.atlassian.net';
const TITLE = 'Payments API runbook';
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const spaceKeyArg = args.includes('--space') ? args[args.indexOf('--space') + 1] : undefined;

const email = process.env.ATLASSIAN_EMAIL;
const tokenFile = process.env.ATLASSIAN_TOKEN_FILE;
if (!email || !tokenFile) {
  console.error('Set ATLASSIAN_EMAIL and ATLASSIAN_TOKEN_FILE.');
  process.exit(1);
}
const auth = 'Basic ' + Buffer.from(`${email}:${readFileSync(tokenFile, 'utf8').trim()}`).toString('base64');

async function api(method, path, body) {
  const res = await fetch(`${SITE}${path}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const file = flag('--fixed') ? 'payments-api-runbook.fixed.adf.json' : 'payments-api-runbook.adf.json';
let adf = JSON.parse(readFileSync(join(here, file), 'utf8'));
if (flag('--plain')) {
  adf = { ...adf, content: adf.content.flatMap((n) => (n.type === 'bodiedExtension' ? n.content : [n])) };
}

const spaces = (await api('GET', '/wiki/api/v2/spaces?limit=50&status=current')).results ?? [];
const space = spacesPick(spaces);
function spacesPick(list) {
  if (spaceKeyArg) return list.find((s) => s.key === spaceKeyArg);
  return list.find((s) => s.type === 'global') ?? list[0];
}
if (!space) {
  console.error('No suitable space found. Pass --space KEY or create a space first.');
  process.exit(1);
}

const existing = (await api('GET', `/wiki/api/v2/spaces/${space.id}/pages?title=${encodeURIComponent(TITLE)}&limit=5`)).results ?? [];
if (existing.length > 0) {
  console.log(`Page already exists: id=${existing[0].id} space=${space.key}`);
  console.log(`${SITE}/wiki/spaces/${space.key}/pages/${existing[0].id}`);
  process.exit(0);
}

const page = await api('POST', '/wiki/api/v2/pages', {
  spaceId: space.id,
  status: 'current',
  title: TITLE,
  body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
});
console.log(`Created page id=${page.id} space=${space.key} macro=${flag('--plain') ? 'no (insert by hand)' : 'yes'}`);
console.log(`${SITE}/wiki/spaces/${space.key}/pages/${page.id}`);
