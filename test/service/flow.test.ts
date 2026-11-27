/**
 * Whole flow without Forge: settings -> queue payload -> index job over a tarball of demo/payments-api ->
 * macro/byline backend check and Rovo/MCP check over the same KVS. Fakes stand in for KVS, the queue and fetch only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runIndexJob } from '../../src/consumers/indexJob';
import { createStorageBackend } from '../../src/resolvers/storageBackend';
import type { UiBackend } from '../../src/resolvers/backend';
import { createAgentService } from '../../src/service/agentService';
import type { CheckDeps } from '../../src/service/check';
import { createClaimExtractor } from '../../src/service/extractor';
import { createIndexLoader } from '../../src/service/indexLoader';
import { clearIndexCache } from '../../src/storage/indexStore';
import { repoKeyOf } from '../../src/storage/keys';
import { buildTarGz, fakeFetch, type Route } from '../repo/helpers';
import { FakeKvs } from '../storage/fakeKvs';

const root = join(import.meta.dirname, '..', '..');
const SHA = 'a'.repeat(40);
const KEY = repoKeyOf('github', 'himanshu748/payments-api', 'main');
const TOKEN = 'github_pat_SECRET_TOKEN_VALUE_123456';
const NOW = Date.parse('2026-12-01T10:00:00Z');

function demoEntries(dir = join(root, 'demo', 'payments-api'), base = dir, out: { path: string; data: string }[] = []): { path: string; data: string }[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) demoEntries(full, base, out);
    else out.push({ path: full.slice(base.length + 1), data: readFileSync(full, 'utf8') });
  }
  return out;
}

const page = (file: string): unknown => JSON.parse(readFileSync(join(root, 'demo', 'confluence', file), 'utf8'));

interface Pushed {
  repoKey: string;
  reason: string;
}

function setup(failFirstEnqueue = false) {
  const kvs = new FakeKvs();
  const pushed: Pushed[] = [];
  const routes: Route[] = [
    (r) => (r.url.startsWith('https://api.github.com/') ? { body: SHA } : undefined),
    (r) => (r.url.startsWith('https://codeload.github.com/') ? { body: buildTarGz(`himanshu748-payments-api-${SHA.slice(0, 7)}`, demoEntries()) } : undefined),
  ];
  const f = fakeFetch(routes);
  const enqueue = async (body: Pushed): Promise<void> => {
    if (failFirstEnqueue) {
      failFirstEnqueue = false;
      throw new Error('queue unavailable');
    }
    pushed.push(body);
  };
  const checkDeps: CheckDeps = {
    indexLoader: createIndexLoader({ kvs, fetch: f.fetch, now: () => NOW, enqueue }),
    extractor: createClaimExtractor(),
    clock: { now: () => new Date(NOW) },
  };
  const backend: UiBackend = createStorageBackend({
    kvs,
    checkDeps: () => checkDeps,
    enqueue,
    readPage: async () => null,
    isAdmin: async () => true,
    now: () => NOW,
  });
  return { kvs, f, pushed, checkDeps, backend };
}

const saved = { repoUrl: 'https://github.com/himanshu748/payments-api', ref: 'main', serviceHosts: [], jiraProjectId: '10000', jiraIssueTypeId: '10001' };

beforeEach(() => clearIndexCache());

describe('full flow over the real modules', () => {
  it('allows a manual retry immediately after the queue rejects the first request', async () => {
    const { pushed, backend } = setup(true);
    await backend.saveSettings(saved, {});
    await expect(backend.enqueueIndex()).rejects.toThrow('queue unavailable');
    expect(await backend.getIndexStatus()).toEqual({ state: 'none' });
    await backend.enqueueIndex();
    expect(pushed).toEqual([{ repoKey: KEY, reason: 'manual' }]);
    expect((await backend.getIndexStatus()).state).toBe('indexing');
  });

  it('walks from empty settings to a green page', async () => {
    const { kvs, f, pushed, checkDeps, backend } = setup();
    const adf = page('payments-api-runbook.adf.json');

    // 1. Nothing configured: a typed state, no verdict.
    expect((await backend.checkDocument({ adf })).state).toBe('no_repo');
    expect(await backend.getIndexStatus()).toEqual({ state: 'none' });

    // 2. Settings: one storage layout (Task B's), token only as a secret.
    await backend.saveSettings(saved, { set: TOKEN });
    expect(await backend.loadSettings()).toEqual(saved);
    expect(await backend.hasToken()).toBe(true);
    expect(JSON.stringify([...kvs.data])).not.toContain(TOKEN);
    expect(kvs.secrets.get('gh-token:site')).toBe(TOKEN);
    expect(kvs.data.has('settings:site')).toBe(true);

    // 3. "Index now": the queue payload is Task B's shape.
    await backend.enqueueIndex();
    expect(pushed).toEqual([{ repoKey: KEY, reason: 'manual' }]);
    expect((await backend.getIndexStatus()).state).toBe('indexing');
    expect((await backend.checkDocument({ adf })).state).toBe('indexing');

    // 4. The consumer builds the index from the tarball (real tar reader and builder).
    const job = await runIndexJob({ kvs, fetch: f.fetch, now: () => NOW }, { body: pushed[0] as { repoKey: string; reason: 'manual' } });
    expect(job).toMatchObject({ outcome: 'indexed', sha: SHA });
    const status = await backend.getIndexStatus();
    expect(status).toMatchObject({ state: 'ready', ref: 'main', sha: SHA });
    expect(status.filesIndexed).toBeGreaterThan(5);
    expect(status.coverage).toMatchObject({ routes: 'complete', env: 'complete', cli: 'complete' });

    // 5. The macro check: 2 verified, 3 contradicted, 1 no evidence, with the headline citations.
    const broken = await backend.checkDocument({ adf, contentId: '6815745' });
    expect(broken.state).toBe('ready');
    if (broken.state !== 'ready') return;
    expect(broken.report.counts).toEqual({ claims: 6, verified: 2, contradicted: 3, unknown: 1 });
    const cite = (raw: string): string[] => broken.report.results.find((r) => r.claim.raw === raw)?.evidence.flatMap((e) => (e.file ? [`${e.file}:${e.line}`] : [])) ?? [];
    expect(cite('POST /v1/charge')[0]).toBe('src/routes.ts:88');
    expect(cite('STRIPE_KEY')[0]).toBe('src/config.ts:8');
    expect(cite('payments refund <paymentId> --force')).toEqual(['src/cli.ts:10', 'src/cli.ts:12', 'src/cli.ts:13']);
    expect(cite('npm run db:migrate')[0]).toBe('package.json:18');
    expect(cite('GET /v2/payments/{id}')[0]).toBe('src/routes.ts:92');
    expect(cite('ledgerctl reconcile --since 24h')).toEqual([]);

    // 6. The Rovo action and MCP tool use the same service and the same index.
    const agent = await createAgentService(checkDeps).checkClaim({ claimText: 'POST /v1/charge' });
    expect(agent.ok).toBe(true);
    if (agent.ok) {
      expect(agent.report.results[0]?.verdict).toBe('contradicted');
      expect(agent.report.results[0]?.evidence[0]).toMatchObject({ file: 'src/routes.ts', line: 88 });
    }
    const agentPage = await createAgentService(checkDeps).checkDocument({ adf, pageId: '6815745' });
    expect(agentPage.ok && agentPage.report.counts).toEqual(broken.report.counts);

    // 7. Fix the page: claim 1 turns green at the same line.
    const fixed = await backend.checkDocument({ adf: page('payments-api-runbook.fixed.adf.json') });
    expect(fixed.state === 'ready' && fixed.report.counts).toEqual({ claims: 6, verified: 3, contradicted: 2, unknown: 1 });

    // 8. Counts are stored with the byline's key.
    await backend.saveCounts('6815745', 4, broken.report.counts);
    expect(kvs.data.get('counts:6815745:4')).toEqual(broken.report.counts);
    expect(await backend.getCounts('6815745', undefined)).toEqual(broken.report.counts);
  });

  it('refuses a macro override that names a repository other than the saved one', async () => {
    const { backend } = setup();
    await backend.saveSettings(saved, {});
    const out = await backend.checkDocument({ adf: page('payments-api-runbook.adf.json'), repoUrl: 'https://github.com/someone/else' });
    expect(out.state).toBe('error');
  });

  it('shows an index error from the consumer in the status and never as a verdict', async () => {
    const { kvs, pushed, backend } = setup();
    await backend.saveSettings(saved, {});
    await backend.enqueueIndex();
    const notFound = fakeFetch([() => ({ status: 404, body: 'Not Found' })]);
    await runIndexJob({ kvs, fetch: notFound.fetch, now: () => NOW }, { body: pushed[0] as { repoKey: string; reason: 'manual' } });
    expect(await backend.getIndexStatus()).toMatchObject({ state: 'error', lastError: 'repo_not_found_or_private' });
    expect((await backend.checkDocument({ adf: page('payments-api-runbook.adf.json') })).state).toBe('repo_not_found');
  });

  it('clears the token through the same helpers', async () => {
    const { kvs, backend } = setup();
    await backend.saveSettings(saved, { set: TOKEN });
    await backend.saveSettings(saved, { clear: true });
    expect(await backend.hasToken()).toBe(false);
    expect(kvs.secrets.has('gh-token:site')).toBe(false);
  });
});

describe('script claims in other package managers verify against package.json:18', () => {
  it.each(['npm run db:migrate', 'yarn db:migrate', 'pnpm run db:migrate', 'pnpm db:migrate'])('%s', async (text) => {
    const { backend, pushed, kvs, f } = setup();
    await backend.saveSettings(saved, {});
    await backend.enqueueIndex();
    await runIndexJob({ kvs, fetch: f.fetch, now: () => NOW }, { body: pushed[0] as { repoKey: string; reason: 'manual' } });
    const out = await createAgentService({
      indexLoader: createIndexLoader({ kvs, fetch: f.fetch, now: () => NOW, enqueue: async () => undefined }),
      extractor: createClaimExtractor(),
      clock: { now: () => new Date(NOW) },
    }).checkClaim({ claimText: `\`${text}\`` });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.report.results[0]).toMatchObject({ verdict: 'verified' });
      expect(out.report.results[0]?.evidence[0]).toMatchObject({ file: 'package.json', line: 18 });
    }
  });
});
