import { describe, expect, it, vi } from 'vitest';
import type { Report } from '../../src/core/model';
import {
  checkClaim,
  checkDocument,
  checkPage,
  type CheckDeps,
  type ClaimExtractor,
  type IndexLoadResult,
  type PageReadResult,
} from '../../src/service/check';
import { demoClaims, demoIndex } from '../fixtures/match/demo';
import { createClaimExtractor } from '../../src/service/extractor';

const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'POST /v1/charge' }] }] };

function setup(over: Partial<CheckDeps> & { load?: IndexLoadResult; page?: PageReadResult } = {}) {
  const extractClaims = vi.fn(() => ({ claims: demoClaims(), truncated: false }));
  const extractClaimsFromText = vi.fn((text: string) => ({ claims: text.includes('POST') ? demoClaims().slice(0, 1) : [], truncated: false }));
  const extractor: ClaimExtractor = { version: 'v1', extractClaims, extractClaimsFromText };
  const loadIndex = vi.fn(async (): Promise<IndexLoadResult> => over.load ?? { ok: true, index: demoIndex(), stale: false });
  const readPage = vi.fn(async (): Promise<PageReadResult> => over.page ?? { ok: true, page: { id: '123', title: 'Payments API runbook', version: 7, adf } });
  const deps: CheckDeps = {
    indexLoader: { loadIndex },
    extractor,
    clock: { now: () => new Date('2026-12-01T12:00:00.000Z') },
    pageReader: { readPage },
    ...over,
  };
  return { deps, extractClaims, extractClaimsFromText, loadIndex, readPage };
}

describe('checkDocument', () => {
  it.each([
    { method: 'HEAD', path: '/health', call: 'curl --head https://api.example.com/health' },
    { method: 'PUT', path: '/reports/42', call: 'curl -T report.json https://api.example.com/reports/42' },
  ] as const)('cites the declared $method route for curl runbook examples', async ({ method, path, call }) => {
    const index = demoIndex();
    index.routes = [{ file: 'src/routes.ts', line: 24, snippet: `router.${method.toLowerCase()}('${path}', handler);`, method, path, framework: 'express' }];
    const { deps } = setup({
      extractor: createClaimExtractor(),
      load: { ok: true, index, stale: false },
      matchOptions: { serviceHosts: ['api.example.com'] },
    });
    const command = { type: 'doc', content: [{ type: 'codeBlock', content: [
      { type: 'text', text: call },
    ] }] };
    const out = await checkDocument(deps, { adf: command });
    expect(out).toMatchObject({ ok: true, report: { counts: { claims: 1, verified: 1, contradicted: 0 }, results: [
      { claim: { normalized: { type: 'http_endpoint', method, path } }, verdict: 'verified', evidence: [{ file: 'src/routes.ts', line: 24 }] },
    ] } });
  });

  it('returns a report with counts for the demo claims', async () => {
    const { deps, loadIndex } = setup();
    const out = await checkDocument(deps, { adf, repoRef: { repoUrl: 'https://github.com/himanshu748/payments-api' } });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report.counts).toEqual({ claims: 6, verified: 2, contradicted: 3, unknown: 1 });
    expect(loadIndex).toHaveBeenCalledWith({ repoUrl: 'https://github.com/himanshu748/payments-api' });
  });

  it('marks the report stale when the loader says so', async () => {
    const { deps } = setup({ load: { ok: true, index: demoIndex(), stale: true } });
    const out = await checkDocument(deps, { adf });
    expect(out.ok && out.report.stale).toBe(true);
  });

  it.each(['index_missing', 'repo_not_found_or_private', 'rate_limited', 'tarball_too_large'] as const)('maps loader failure %s to an error, never a verdict', async (reason) => {
    const { deps, extractClaims } = setup({ load: { ok: false, reason } });
    const out = await checkDocument(deps, { adf });
    expect(out).toMatchObject({ ok: false, error: reason });
    if (out.ok) return;
    expect(out.message).toContain('not a confirmation');
    expect(extractClaims).not.toHaveBeenCalled();
  });

  it('rejects empty, unserializable and oversized documents', async () => {
    const { deps } = setup();
    expect(await checkDocument(deps, { adf: undefined })).toMatchObject({ ok: false, error: 'invalid_input' });
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(await checkDocument(deps, { adf: cyclic })).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await checkDocument(deps, { adf: { text: 'x'.repeat(400 * 1024) } })).toMatchObject({ ok: false, error: 'invalid_input' });
  });

  it('caps claims at 200 and reports truncation', async () => {
    const many = Array.from({ length: 250 }, () => demoClaims().slice(0, 1)).flat();
    const { deps } = setup();
    deps.extractor = { extractClaims: () => ({ claims: many, truncated: false }), extractClaimsFromText: () => ({ claims: [], truncated: false }) };
    const out = await checkDocument(deps, { adf });
    expect(out.ok && out.report.results).toHaveLength(200);
    expect(out.ok && out.report.limits.claimsTruncated).toBe(true);
  });

  it('uses the report cache and keys it by document, commit and extractor version', async () => {
    const store = new Map<string, Report>();
    const reportCache = {
      get: vi.fn(async (key: string) => store.get(key)),
      set: vi.fn(async (key: string, report: Report) => void store.set(key, report)),
    };
    const { deps, extractClaims } = setup({ reportCache });
    const first = await checkDocument(deps, { adf });
    const second = await checkDocument(deps, { adf });
    expect(extractClaims).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    const [key] = [...store.keys()];
    expect(key).toMatch(/^report:[0-9a-f]{32}$/);
    await checkDocument(deps, { adf: { ...adf, version: 2 } });
    expect(extractClaims).toHaveBeenCalledTimes(2);
    deps.extractor = { ...deps.extractor, version: 'v2' };
    await checkDocument(deps, { adf });
    expect(extractClaims).toHaveBeenCalledTimes(3);
  });

  it('records counts for the byline when content id and version are known', async () => {
    const set = vi.fn(async () => undefined);
    const { deps } = setup({ countsStore: { set } });
    await checkDocument(deps, { adf, contentId: '123', version: 7 });
    expect(set).toHaveBeenCalledWith('counts:123:7', { counts: { claims: 6, verified: 2, contradicted: 3, unknown: 1 }, checkedAt: '2026-12-01T12:00:00.000Z' });
    set.mockClear();
    await checkDocument(deps, { adf });
    expect(set).not.toHaveBeenCalled();
  });
});

describe('checkClaim', () => {
  it('checks the claims found in a short text', async () => {
    const { deps } = setup();
    const out = await checkClaim(deps, { text: ' POST /v1/charge ' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report.counts.contradicted).toBe(1);
    expect(out.report.results[0]?.evidence[0]).toMatchObject({ file: 'src/routes.ts', line: 88 });
  });
  it('rejects empty and long text', async () => {
    const { deps } = setup();
    expect(await checkClaim(deps, { text: '   ' })).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await checkClaim(deps, { text: 'x'.repeat(301) })).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await checkClaim(deps, { text: 5 as unknown as string })).toMatchObject({ ok: false, error: 'invalid_input' });
  });
  it('answers not_a_checkable_claim without loading the index', async () => {
    const { deps, loadIndex } = setup();
    const out = await checkClaim(deps, { text: 'hello there' });
    expect(out).toMatchObject({ ok: false, error: 'not_a_checkable_claim' });
    expect(out.ok ? '' : out.message).toContain('not a confirmation');
    expect(loadIndex).not.toHaveBeenCalled();
  });
  it('passes loader failures through', async () => {
    const { deps } = setup({ load: { ok: false, reason: 'rate_limited' } });
    expect(await checkClaim(deps, { text: 'POST /v1/charge' })).toMatchObject({ ok: false, error: 'rate_limited' });
  });
});

describe('checkPage', () => {
  it('reads the page, checks it and builds the agent envelope', async () => {
    const { deps, readPage } = setup();
    const out = await checkPage(deps, { pageId: '123' });
    expect(readPage).toHaveBeenCalledWith('123');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.envelope).toMatchObject({ schema: 'pil.agent.v1', page: { id: '123', untrustedTitle: 'Payments API runbook', version: 7 }, counts: { claims: 6 } });
  });
  it('rejects bad ids, unreadable pages and a missing reader', async () => {
    const { deps } = setup();
    expect(await checkPage(deps, { pageId: '12; drop' })).toMatchObject({ ok: false, error: 'invalid_input' });
    const denied = setup({ page: { ok: false, reason: 'forbidden' } });
    expect(await checkPage(denied.deps, { pageId: '1' })).toMatchObject({ ok: false, error: 'forbidden' });
    const missing = setup({ page: { ok: false, reason: 'page_not_found' } });
    expect(await checkPage(missing.deps, { pageId: '1' })).toMatchObject({ ok: false, error: 'page_not_found' });
    const { pageReader: _unused, ...noReader } = deps;
    expect(await checkPage(noReader, { pageId: '1' })).toMatchObject({ ok: false, error: 'internal_error' });
  });
  it('passes a loader failure through', async () => {
    const { deps } = setup({ load: { ok: false, reason: 'index_missing' } });
    expect(await checkPage(deps, { pageId: '1', repoRef: { ref: 'dev' } })).toMatchObject({ ok: false, error: 'index_missing' });
  });
});
