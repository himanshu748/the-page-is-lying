/**
 * Live check against the public demo repo. Skipped unless LIVE_GITHUB=1 (needs network, uses the unauthenticated
 * GitHub rate limit): `LIVE_GITHUB=1 npx vitest run test/live`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runIndexJob } from '../../src/consumers/indexJob';
import { createAgentService } from '../../src/service/agentService';
import { checkDocument } from '../../src/service/check';
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

describe.skipIf(!live)(`live GitHub: ${demoRepository}`, () => {
  it('indexes the public repo and reproduces the golden verdicts', async () => {
    const kvs = new FakeKvs();
    const now = (): number => Date.now();
    await saveSettings(kvs, { repoUrl: `https://github.com/${demoRepository}`, ref: demoRevision });
    const repoKey = repoKeyOf('github', demoRepository, demoRevision);
    const job = await runIndexJob({ kvs, fetch: nodeFetch, now }, { body: { repoKey, reason: 'manual' } });
    expect(job.outcome).toBe('indexed');
    const deps = {
      indexLoader: createIndexLoader({ kvs, fetch: nodeFetch, now, enqueue: async () => undefined }),
      extractor: createClaimExtractor(),
      clock: { now: () => new Date() },
    };
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
