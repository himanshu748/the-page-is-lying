#!/usr/bin/env node
// Switch claim 1 on the live demo page between the broken and fixed wording using Confluence REST v2.
// Reads the live body, swaps only the claim text (so the macro node and extension key stay as they are),
// and PUTs a new version. The token is read from ATLASSIAN_TOKEN_FILE inside this process and never printed.
//   ATLASSIAN_EMAIL=... ATLASSIAN_TOKEN_FILE=... [PAGE_ID=...] node video/tools/page-toggle.mjs fix|restore|status
// The default page is the production demo page; the token can also come from ATLASSIAN_TOKEN.
import { readFileSync } from 'node:fs';
const SITE = 'https://one-atlas-obka.atlassian.net', ID = process.env.PAGE_ID ?? '8617986';
const BAD = 'POST /v1/charge', GOOD = 'POST /v2/payments';
const mode = process.argv[2];
const auth = 'Basic ' + Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${(process.env.ATLASSIAN_TOKEN ?? readFileSync(process.env.ATLASSIAN_TOKEN_FILE, 'utf8')).trim()}`).toString('base64');
const h = { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' };
const page = await (await fetch(`${SITE}/wiki/api/v2/pages/${ID}?body-format=atlas_doc_format`, { headers: h })).json();
const body = page.body.atlas_doc_format.value;
const has = (s) => body.includes(s);
console.log('version', page.version.number, 'broken text present', has(BAD), 'fixed text present', has(GOOD));
if (mode === 'status') process.exit(0);
const [from, to] = mode === 'fix' ? [BAD, GOOD] : [GOOD, BAD];
if (!has(from)) { console.log('nothing to change'); process.exit(0); }
const res = await fetch(`${SITE}/wiki/api/v2/pages/${ID}`, { method: 'PUT', headers: h, body: JSON.stringify({
  id: ID, status: 'current', title: page.title, body: { representation: 'atlas_doc_format', value: body.split(from).join(to) },
  version: { number: page.version.number + 1, message: `demo video: ${mode}` } }) });
console.log(mode, res.status, res.ok ? 'ok' : (await res.text()).slice(0, 200));
