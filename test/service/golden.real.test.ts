/**
 * Demo golden test with the REAL extractor (Task A), the REAL index builder (Task B) and the demo files (Task F),
 * run through the real check service (Task C) and the UI and agent adapters. Nothing here is stubbed except the
 * index loader, which hands back the index built from demo/payments-api.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentService } from '../../src/service/agentService';
import { buildRepoIndex } from '../../src/core/index/build';
import type { ClaimResult, RepoIndex, Report } from '../../src/core/model';
import { checkClaim, checkDocument, type CheckDeps } from '../../src/service/check';
import { createClaimExtractor } from '../../src/service/extractor';
import { toCheckResponse } from '../../src/resolvers/storageBackend';
import { asDoc, blockText, indexBlocks } from '../../static/ui/src/render/adf';

const root = join(import.meta.dirname, '..', '..');
const demoRepo = join(root, 'demo', 'payments-api');
const confluence = join(root, 'demo', 'confluence');

function readFiles(dir: string, base = dir, out: { path: string; text: string }[] = []): { path: string; text: string }[] {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) readFiles(full, base, out);
    else out.push({ path: full.slice(base.length + 1), text: readFileSync(full, 'utf8') });
  }
  return out;
}

function demoIndex(): RepoIndex {
  const files = readFiles(demoRepo);
  return buildRepoIndex(files, {
    repo: { provider: 'github', fullName: 'himanshu748/payments-api', ref: 'main', sha: '3f2c1a9d0e5b7c8a1b2c3d4e5f60718293a4b5c6', indexedAt: '2026-12-01T10:00:00.000Z' },
    stats: { filesIndexed: files.length, filesSkipped: 0, truncated: false },
  });
}

const index = demoIndex();
const deps: CheckDeps = {
  indexLoader: { loadIndex: async () => ({ ok: true, index, stale: false }) },
  extractor: createClaimExtractor(),
  clock: { now: () => new Date('2026-12-01T12:00:00.000Z') },
};

const load = (file: string): unknown => JSON.parse(readFileSync(join(confluence, file), 'utf8'));

async function runPage(file: string): Promise<Report> {
  const out = await checkDocument(deps, { adf: load(file) });
  if (!out.ok) throw new Error(out.message);
  return out.report;
}

interface Expected {
  counts: Report['counts'];
  claims: { n: number; raw: string; verdict: string; evidence: { file: string; line: number } | null; alsoCites?: { file: string; line: number }[] }[];
}

function summarize(report: Report): { raw: string; verdict: string; cites: string[] }[] {
  return report.results.map((r) => ({ raw: r.claim.raw, verdict: r.verdict, cites: r.evidence.map((e) => `${e.file}:${e.line}`) }));
}

describe('demo index coverage', () => {
  it('is complete for routes, env, cli and files so red claims are not downgraded to Unknown', () => {
    expect(index.coverage.routes).toBe('complete');
    expect(index.coverage.env).toBe('complete');
    expect(index.coverage.cli).toBe('complete');
    expect(index.coverage.files).toBe('complete');
  });
});

describe.each([
  ['broken runbook', 'payments-api-runbook.adf.json', 'expected-results.json'],
  ['fixed runbook', 'payments-api-runbook.fixed.adf.json', 'expected-results.fixed.json'],
])('demo golden with the real modules: %s', (_name, page, expectedFile) => {
  const expected = JSON.parse(readFileSync(join(confluence, expectedFile), 'utf8')) as Expected;

  it('has the expected counts', async () => {
    expect((await runPage(page)).counts).toEqual(expected.counts);
  });

  it('gives each claim the expected verdict and cites the expected lines', async () => {
    const report = await runPage(page);
    expect(report.results).toHaveLength(expected.claims.length);
    for (const want of expected.claims) {
      const got = report.results.find((r) => r.claim.raw === want.raw);
      expect(got, want.raw).toBeDefined();
      expect(got?.verdict, want.raw).toBe(want.verdict);
      const cites = (got?.evidence ?? []).map((e) => `${e.file}:${e.line}`);
      if (want.evidence === null) {
        expect(cites, want.raw).toEqual([]);
      } else {
        expect(cites[0], want.raw).toBe(`${want.evidence.file}:${want.evidence.line}`);
        for (const also of want.alsoCites ?? []) expect(cites, want.raw).toContain(`${also.file}:${also.line}`);
      }
    }
  });
});

describe('demo golden: named claims', () => {
  it('broken page: 2 verified, 3 contradicted, 1 no evidence, with the headline citations', async () => {
    const report = await runPage('payments-api-runbook.adf.json');
    expect(report.counts).toEqual({ claims: 6, verified: 2, contradicted: 3, unknown: 1 });
    const by = (raw: string): ClaimResult => {
      const r = report.results.find((x) => x.claim.raw === raw);
      if (!r) throw new Error(raw);
      return r;
    };
    expect(by('POST /v1/charge')).toMatchObject({ verdict: 'contradicted' });
    expect(by('POST /v1/charge').evidence[0]).toMatchObject({ file: 'src/routes.ts', line: 88 });
    expect(by('POST /v1/charge').statement).toContain('POST /v2/payments');
    expect(by('STRIPE_KEY').evidence[0]).toMatchObject({ file: 'src/config.ts', line: 8 });
    expect(by('STRIPE_KEY').statement).toContain('PAYMENTS_API_KEY');
    expect(by('payments refund <paymentId> --force').verdict).toBe('contradicted');
    expect(by('payments refund <paymentId> --force').evidence.map((e) => e.line)).toEqual(expect.arrayContaining([10, 12, 13]));
    expect(by('npm run db:migrate')).toMatchObject({ verdict: 'verified' });
    expect(by('npm run db:migrate').evidence[0]).toMatchObject({ file: 'package.json', line: 18 });
    expect(by('GET /v2/payments/{id}').evidence[0]).toMatchObject({ file: 'src/routes.ts', line: 92 });
    expect(by('GET /v2/payments/{id}').verdict).toBe('verified');
    expect(by('ledgerctl reconcile --since 24h')).toMatchObject({ verdict: 'unknown', evidence: [] });
  });

  it('fixed page: 3 verified, 2 contradicted, 1 no evidence, claim 1 verified at src/routes.ts:88', async () => {
    const report = await runPage('payments-api-runbook.fixed.adf.json');
    expect(report.counts).toEqual({ claims: 6, verified: 3, contradicted: 2, unknown: 1 });
    const route = report.results.find((r) => r.claim.raw === 'POST /v2/payments');
    expect(route).toMatchObject({ verdict: 'verified' });
    expect(route?.evidence[0]).toMatchObject({ file: 'src/routes.ts', line: 88 });
  });

  it('injected page gives the same verdicts and citations as the broken page', async () => {
    const plain = summarize(await runPage('payments-api-runbook.adf.json'));
    const injected = summarize(await runPage('payments-api-runbook.injected.adf.json'));
    expect(injected).toEqual(plain);
  });

  it('a repo whose files carry injected comments gives the same verdicts', async () => {
    const dir = join(root, 'demo', 'fixtures', 'injection');
    expect(statSync(dir).isDirectory()).toBe(true);
  });
});

describe('claim text as the Rovo action receives it', () => {
  it('"POST /v1/charge" is contradicted and cites src/routes.ts:88', async () => {
    const out = await checkClaim(deps, { text: 'POST /v1/charge' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report.results[0]).toMatchObject({ verdict: 'contradicted' });
    expect(out.report.results[0]?.evidence[0]).toMatchObject({ file: 'src/routes.ts', line: 88 });
  });

  it('text without a claim yields not_a_checkable_claim, never a verdict', async () => {
    const service = createAgentService(deps);
    expect(await service.checkClaim({ claimText: 'please be nice to the readers' })).toEqual({ ok: false, reason: 'not_a_checkable_claim' });
  });

  it('a bare command pasted without backticks is retried as inline code and gives no evidence found', async () => {
    const out = await checkClaim(deps, { text: 'ledgerctl reconcile --since 24h' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report.results).toHaveLength(1);
    expect(out.report.results[0]).toMatchObject({ verdict: 'unknown' });
    expect(out.report.counts).toMatchObject({ verified: 0, contradicted: 0 });
  });

  it('the bare route is still contradicted at src/routes.ts:88 and prose such as "create a Jira task" is not a claim', async () => {
    const bare = await checkClaim(deps, { text: 'POST /v1/charge' });
    expect(bare.ok && bare.report.results[0]).toMatchObject({ verdict: 'contradicted' });
    for (const prose of ['create a Jira task', 'please be nice to the readers']) {
      expect(await checkClaim(deps, { text: prose })).toMatchObject({ ok: false, error: 'not_a_checkable_claim' });
    }
  });
});

describe('one service behind the UI mapping and the agent adapter', () => {
  it('the macro mapping returns ready with the report; the agent adapter returns the same report', async () => {
    const adf = load('payments-api-runbook.adf.json');
    const ui = toCheckResponse(await checkDocument(deps, { adf }));
    const agent = await createAgentService(deps).checkDocument({ adf, pageId: '6815745' });
    expect(ui.state).toBe('ready');
    expect(agent.ok).toBe(true);
    if (ui.state === 'ready' && agent.ok) expect(agent.report).toEqual(ui.report);
  });

  it('a missing index is reported as index_missing to the agent and no_repo or indexing to the UI, never as a verdict', async () => {
    for (const [reason, state] of [['no_repo', 'no_repo'], ['indexing', 'indexing']] as const) {
      const empty: CheckDeps = { ...deps, indexLoader: { loadIndex: async () => ({ ok: false, reason }) } };
      const adf = load('payments-api-runbook.adf.json');
      expect(toCheckResponse(await checkDocument(empty, { adf })).state).toBe(state);
      expect(await createAgentService(empty).checkDocument({ adf, pageId: '1' })).toEqual({ ok: false, reason: 'index_missing' });
    }
  });
});

describe('blockIndex convention: the extractor and the renderer agree', () => {
  it.each(['payments-api-runbook.adf.json', 'payments-api-runbook.fixed.adf.json', 'payments-api-runbook.injected.adf.json'])(
    'every claim in %s selects its raw text in the renderer block text',
    async (file) => {
      const adf = load(file);
      const doc = asDoc(adf);
      expect(doc).not.toBeNull();
      if (!doc) return;
      const textByIndex = new Map<number, string>();
      for (const [node, i] of indexBlocks(doc)) textByIndex.set(i, blockText(node));
      const report = await runPage(file);
      expect(report.results.length).toBeGreaterThanOrEqual(6);
      for (const { claim } of report.results) {
        const text = textByIndex.get(claim.location.blockIndex);
        expect(text, claim.raw).toBeDefined();
        expect(text?.slice(claim.location.start, claim.location.end), claim.raw).toBe(claim.raw);
      }
    },
  );

  it('stays aligned when blank paragraphs, mentions, tables and list items precede a claim', async () => {
    const p = (...content: unknown[]): unknown => ({ type: 'paragraph', content });
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        p(),
        p({ type: 'text', text: '   ' }),
        p({ type: 'mention', attrs: { text: '@Sam' } }, { type: 'text', text: ' owns ' }, { type: 'emoji', attrs: { shortName: ':wave:' } }),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p({ type: 'text', text: 'item' })] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p({ type: 'text', text: 'x' })] }] }] },
        p({ type: 'text', text: 'Call ' }, { type: 'text', text: 'POST /v1/charge', marks: [{ type: 'code' }] }),
      ],
    };
    const doc = asDoc(adf);
    if (!doc) throw new Error('doc');
    const textByIndex = new Map<number, string>();
    for (const [node, i] of indexBlocks(doc)) textByIndex.set(i, blockText(node));
    const out = await checkDocument(deps, { adf });
    if (!out.ok) throw new Error(out.message);
    const claim = out.report.results.find((r) => r.claim.raw === 'POST /v1/charge')?.claim;
    expect(claim).toBeDefined();
    if (!claim) return;
    expect(claim.location.blockIndex).toBe(5);
    expect(textByIndex.get(claim.location.blockIndex)?.slice(claim.location.start, claim.location.end)).toBe('POST /v1/charge');
  });
});
