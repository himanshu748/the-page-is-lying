/**
 * Live checks against public repos. Skipped unless LIVE_GITHUB=1 (needs network, uses the unauthenticated
 * GitHub rate limit): `LIVE_GITHUB=1 npx vitest run test/live`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runIndexJob } from '../../src/consumers/indexJob';
import { createAgentService } from '../../src/service/agentService';
import { checkClaim, checkDocument, type CheckDeps } from '../../src/service/check';
import { createClaimExtractor } from '../../src/service/extractor';
import { createIndexLoader } from '../../src/service/indexLoader';
import { repoKeyOf } from '../../src/storage/keys';
import { saveSettings } from '../../src/storage/settings';
import type { FetchFn } from '../../src/repo/source';
import { FakeKvs } from '../storage/fakeKvs';

const live = process.env['LIVE_GITHUB'] === '1';
const demoRepository = 'himanshu748/payments-api-demo';
const demoRevision = '44c8112e1bc0f3be63fe45fbcb70bfaf6bfb03a5';
const nodeFetch: FetchFn = async (url, init) => fetch(url, init as RequestInit) as never;

async function indexPinnedRepository(repository: string, revision: string): Promise<CheckDeps> {
  const kvs = new FakeKvs();
  const now = (): number => Date.now();
  await saveSettings(kvs, { repoUrl: `https://github.com/${repository}`, ref: revision });
  const repoKey = repoKeyOf('github', repository, revision);
  const job = await runIndexJob({ kvs, fetch: nodeFetch, now }, { body: { repoKey, reason: 'manual' } });
  expect(job.outcome).toBe('indexed');
  return {
    indexLoader: createIndexLoader({ kvs, fetch: nodeFetch, now, enqueue: async () => undefined }),
    extractor: createClaimExtractor(),
    clock: { now: () => new Date() },
  };
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
    const response = await fetch(`https://raw.githubusercontent.com/${repository}/${revision}/README.md`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub README request returned HTTP ${response.status}`);
    const lines = (await response.text()).split('\n');
    const row = /^\|`(-{1,2}dir-overrides-404)`\s*\|/;
    const rowIndex = lines.findIndex((line) => row.test(line));
    const documentedFlag = lines[rowIndex]?.match(row)?.[1];
    if (!documentedFlag) throw new Error('Could not find the flag in the pinned README option table');

    const deps = await indexPinnedRepository(repository, revision);
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

    console.info(`README source: https://github.com/${repository}/blob/${revision}/README.md#L${rowIndex + 1}`);
    console.info(contradicted?.statement);
    console.info(`Suggested command: ${contradicted?.suggestion?.replacement}`);
    console.info(verified?.statement);
    console.info(`Flag source: ${contradicted?.evidence[0]?.permalink}`);
  }, 60_000);
});
