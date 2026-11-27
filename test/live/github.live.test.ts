/**
 * Live checks against public repos. Skipped unless LIVE_GITHUB=1 (needs network, uses the unauthenticated
 * GitHub rate limit): `LIVE_GITHUB=1 npx vitest run test/live`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runIndexJob } from '../../src/consumers/indexJob';
import { createAgentService } from '../../src/service/agentService';
import type { ClaimType } from '../../src/core/model';
import { checkClaim, checkDocument, type CheckDeps } from '../../src/service/check';
import { createClaimExtractor } from '../../src/service/extractor';
import { createIndexLoader } from '../../src/service/indexLoader';
import { repoKeyOf } from '../../src/storage/keys';
import { saveSettings } from '../../src/storage/settings';
import { getStatus } from '../../src/storage/status';
import type { FetchFn } from '../../src/repo/source';
import { FakeKvs } from '../storage/fakeKvs';

const live = process.env['LIVE_GITHUB'] === '1';
const demoRepository = 'himanshu748/payments-api-demo';
const demoRevision = '44c8112e1bc0f3be63fe45fbcb70bfaf6bfb03a5';

async function fetchPublicGithub(url: string, init?: Parameters<FetchFn>[1]): Promise<Response> {
  const request = () => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const response = await request().catch(() => undefined);
  if (response && response.status < 500) return response;
  await response?.body?.cancel();
  // A public replay can see a transient transport or gateway error.
  return request();
}

async function indexPinnedRepository(repository: string, revision: string): Promise<CheckDeps> {
  const kvs = new FakeKvs();
  const now = (): number => Date.now();
  await saveSettings(kvs, { repoUrl: `https://github.com/${repository}`, ref: revision });
  const repoKey = repoKeyOf('github', repository, revision);
  const job = await runIndexJob({ kvs, fetch: fetchPublicGithub, now }, { body: { repoKey, reason: 'manual' } });
  if (job.outcome !== 'indexed') {
    const status = await getStatus(kvs, repoKey);
    throw new Error(`Could not index ${repository}@${revision}: ${status?.message ?? JSON.stringify(job)}`);
  }
  return {
    indexLoader: createIndexLoader({ kvs, fetch: fetchPublicGithub, now, enqueue: async () => undefined }),
    extractor: createClaimExtractor(),
    clock: { now: () => new Date() },
  };
}

async function readUpstreamDocument(repository: string, revision: string, path: string) {
  const response = await fetchPublicGithub(`https://raw.githubusercontent.com/${repository}/${revision}/${path}`);
  if (!response.ok) throw new Error(`GitHub request for ${path} returned HTTP ${response.status}`);
  return {
    lines: (await response.text()).split('\n'),
    url: `https://github.com/${repository}/blob/${revision}/${path}`,
  };
}

async function verifyDocumentedClaim(
  deps: CheckDeps,
  revision: string,
  input: { text: string; type: ClaimType; url: string },
  citation: { file: string; line: number },
) {
  const checked = await checkClaim(deps, { text: input.text });
  if (!checked.ok) throw new Error(`${input.url}: ${checked.message}`);
  const result = checked.report.results.find(({ claim }) => claim.type === input.type);
  expect(checked.report.repo.sha).toBe(revision);
  expect(result, input.url).toMatchObject({ verdict: 'verified' });
  expect(result?.evidence[0], input.url).toMatchObject(citation);
  console.info(`${input.text.trim()}\n  Documentation: ${input.url}\n  Verified by: ${result?.evidence[0]?.permalink}`);
  return result;
}

describe.skipIf(!live)(`live GitHub: ${demoRepository}`, () => {
  it('indexes the public repo and reproduces the golden verdicts', async () => {
    const deps = await indexPinnedRepository(demoRepository, demoRevision);
    const adf = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'demo', 'confluence', 'payments-api-runbook.adf.json'), 'utf8')) as unknown;
    const out = await checkDocument(deps, { adf });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.report.counts).toEqual({ claims: 6, verified: 2, contradicted: 3, unknown: 1 });
      expect(out.report.results.find((r) => r.claim.raw === 'POST /v1/charge')?.evidence[0]).toMatchObject({ file: 'src/routes.ts', line: 88 });
    }
    const claim = await createAgentService(deps).checkClaim({ claimText: 'POST /v1/charge' });
    expect(claim.ok && claim.report.results[0]?.verdict).toBe('contradicted');
  }, 60_000);
});

describe.skipIf(!live)('live GitHub: http-party/http-server', () => {
  it('reproduces the README flag mismatch and verifies the corrected flag', async () => {
    const repository = 'http-party/http-server';
    const revision = '0d3b7bb5b6e8a59fd450ae2dca65870009cfcd8b';
    const [deps, { lines, url }] = await Promise.all([
      indexPinnedRepository(repository, revision),
      readUpstreamDocument(repository, revision, 'README.md'),
    ]);
    const row = /^\|`(-{1,2}dir-overrides-404)`\s*\|/;
    const rowIndex = lines.findIndex((line) => row.test(line));
    const documentedFlag = lines[rowIndex]?.match(row)?.[1];
    if (!documentedFlag) throw new Error('Could not find the flag in the pinned README option table');

    const before = await checkClaim(deps, { text: `http-server ${documentedFlag}` });
    const after = await checkClaim(deps, { text: 'http-server --dir-overrides-404' });
    if (!before.ok) throw new Error(before.message);
    if (!after.ok) throw new Error(after.message);

    const contradicted = before.report.results[0];
    const verified = after.report.results[0];
    expect(before.report.repo.sha).toBe(revision);
    expect(after.report.repo.sha).toBe(revision);
    expect(contradicted).toMatchObject({
      verdict: 'contradicted',
      suggestion: { replacement: 'http-server --dir-overrides-404' },
    });
    expect(contradicted?.evidence[0]).toMatchObject({ file: 'bin/http-server', line: 203 });
    expect(verified).toMatchObject({ verdict: 'verified' });
    expect(verified?.evidence[0]).toMatchObject({ file: 'bin/http-server', line: 13 });

    console.info(`README source: ${url}#L${rowIndex + 1}`);
    console.info(contradicted?.statement);
    console.info(`Suggested command: ${contradicted?.suggestion?.replacement}`);
    console.info(verified?.statement);
    console.info(`Flag source: ${contradicted?.evidence[0]?.permalink}`);
  }, 60_000);
});

describe.skipIf(!live)('live GitHub: typicode/json-server', () => {
  it('verifies the README routes and a command that serves extra static files', async () => {
    const repository = 'typicode/json-server';
    const revision = '89a34a44b7a6a5311dc84f3b8a1b8b45c0905aea';
    const [deps, { lines, url }] = await Promise.all([
      indexPinnedRepository(repository, revision),
      readUpstreamDocument(repository, revision, 'README.md'),
    ]);
    // README line followed by the handler it should match in src/app.ts.
    const routes = [
      [125, 123],
      [139, 123], [140, 137], [141, 143], [142, 147], [143, 151], [144, 153],
      [152, 123], [153, 145], [154, 149],
    ] as const;
    for (const [docLine, handlerLine] of routes) {
      const text = lines[docLine - 1] ?? '';
      expect(text).toMatch(/^(GET|POST|PUT|PATCH|DELETE)\s+\//);
      await verifyDocumentedClaim(deps, revision, { text, type: 'http_endpoint', url: `${url}#L${docLine}` },
        { file: 'src/app.ts', line: handlerLine });
    }
    const staticLine = 248;
    const command = lines[staticLine - 1] ?? '';
    expect(command).toBe('json-server db.json -s ./static');
    const result = await verifyDocumentedClaim(deps, revision,
      { text: command, type: 'cli', url: `${url}#L${staticLine}` }, { file: 'src/bin.ts', line: 43 });
    expect(result?.claim.normalized).toMatchObject({ program: 'json-server', flags: ['-s'] });
  }, 60_000);
});

describe.skipIf(!live)('live GitHub: pallets/flask', () => {
  it('verifies the installation guide’s supported Python range', async () => {
    const repository = 'pallets/flask';
    const revision = '49943b5a94413a530761350f04e896f76e8d620e';
    const [deps, { lines, url }] = await Promise.all([
      indexPinnedRepository(repository, revision),
      readUpstreamDocument(repository, revision, 'docs/installation.rst'),
    ]);
    const docLine = 8;
    const text = lines[docLine - 1] ?? '';
    expect(text).toContain('Flask supports Python 3.11 and newer.');
    const result = await verifyDocumentedClaim(deps, revision,
      { text, type: 'package_version', url: `${url}#L${docLine}` }, { file: 'pyproject.toml', line: 22 });
    expect(result).toMatchObject({
      reason: 'package_range_intersects',
      claim: { normalized: { ecosystem: 'runtime', name: 'python', range: '>=3.11' } },
    });
  }, 60_000);
});
