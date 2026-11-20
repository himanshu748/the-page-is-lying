import { describe, expect, it, vi } from 'vitest';
import { createAuditSpaceHandler, rankAudited } from '../../src/actions/auditSpace';
import type { AuditEnvelope, AuditedPage } from '../../src/actions/auditSpace';
import { createExplainClaimHandler } from '../../src/actions/explainClaim';
import type { ExplainEnvelope } from '../../src/actions/explainClaim';
import { createSuggestFixHandler } from '../../src/actions/suggestFix';
import type { FixEnvelope } from '../../src/actions/suggestFix';
import { cleanName, contactIds } from '../../src/actions/contacts';
import type { PageReader } from '../../src/actions/pageReader';
import type { CheckService, ServiceOutcome } from '../../src/actions/service';
import type { SpaceReader } from '../../src/actions/spaceReader';
import { toSpacePage } from '../../src/actions/spaceReader';
import type { ClaimResult } from '../../src/core/model';
import { makeReport, makeResult } from './fixtures';

const contradicted = (id = 'c_00000001'): ClaimResult => ({
  ...makeResult(id, 'contradicted'),
  suggestion: { kind: 'replace', replacement: 'POST /v2/payments', evidenceId: `ev_${id.slice(2)}`, alternatives: ['GET /v2/payments/:param'] },
});
const verified = (id = 'c_00000002'): ClaimResult => makeResult(id, 'verified', { raw: 'GET /v2/payments/{id}' });
const unknown = (id = 'c_00000003'): ClaimResult => makeResult(id, 'unknown', { raw: 'ledgerctl reconcile' });

function service(outcome: ServiceOutcome | ((input: { pageId?: string }) => ServiceOutcome)) {
  const run = (input: { pageId?: string }) => Promise.resolve(typeof outcome === 'function' ? outcome(input) : outcome);
  const svc = { checkDocument: vi.fn(run), checkClaim: vi.fn(run) };
  return svc as CheckService & typeof svc;
}

const okPage: PageReader = (id) => Promise.resolve({ ok: true, page: { id, title: 'Payments API runbook', version: 7, adf: { type: 'doc', content: [] } } });
const ctx = { context: { confluence: { contentId: '123456' } } };

describe('explain-claim handler', () => {
  it('returns the rule, the parsed claim, the searched index and the same evidence ids as check-claim', async () => {
    const svc = service({ ok: true, report: makeReport([contradicted()]) });
    const out = (await createExplainClaimHandler({ service: () => svc })({ claim: 'POST /v1/charge' })) as ExplainEnvelope;
    expect(out.schema).toBe('pil.agent.explain.v1');
    expect(out.repo).toMatchObject({ fullName: 'acme/payments-api', ref: 'main' });
    expect(out.explanations).toHaveLength(1);
    expect(out.explanations[0]).toMatchObject({
      claimId: 'c_00000001',
      verdict: 'contradicted',
      reason: 'route_absent_nearest',
      rule: 'Route coverage is complete and no route matches. The nearest routes are cited.',
      untrustedParsed: { method: 'POST', path: '/v1/charge' },
      searched: { index: 'routes', coverage: 'complete' },
      evidenceRoles: { match: [], nearest: ['ev_00000001'], absence: [], coverage: [] },
      suggestion: { kind: 'replace', untrustedReplacement: 'POST /v2/payments', evidenceId: 'ev_00000001' },
    });
    expect(out.explanations[0]?.evidence[0]?.id).toBe('ev_00000001');
    expect(svc.checkClaim).toHaveBeenCalledWith({ claimText: 'POST /v1/charge' });
  });

  it('explains a no-evidence result without calling it a pass', async () => {
    const out = (await createExplainClaimHandler({ service: () => service({ ok: true, report: makeReport([unknown()]) }) })({ claim: 'ledgerctl reconcile' })) as ExplainEnvelope;
    expect(out.explanations[0]).toMatchObject({ verdict: 'unknown', suggestion: { kind: 'none' } });
    expect(out.explanations[0]?.rule).toContain('No evidence was found');
    expect(out.explanations[0]?.suggestion.statement).toContain('not a confirmation');
  });

  it('returns typed errors and never a verdict when the check cannot run', async () => {
    const handler = createExplainClaimHandler({ service: () => service({ ok: false, reason: 'index_missing' }) });
    expect(await handler({})).toMatchObject({ schema: 'pil.agent.error.v1', error: 'invalid_input' });
    expect(await handler({ claim: 'POST /v1/charge' })).toMatchObject({ schema: 'pil.agent.error.v1', error: 'index_missing' });
    const throwing = createExplainClaimHandler({ service: () => { throw new Error('boom'); } });
    expect(await throwing({ claim: 'POST /v1/charge' })).toMatchObject({ error: 'internal_error' });
  });
});

describe('suggest-fix handler', () => {
  it('with a claim: proposes the edit and cites the evidence id it came from', async () => {
    const svc = service({ ok: true, report: makeReport([contradicted()]) });
    const out = (await createSuggestFixHandler({ service: () => svc, readPage: okPage })({ claim: 'POST /v1/charge' })) as FixEnvelope;
    expect(out).toMatchObject({ schema: 'pil.agent.fix.v1', applied: false });
    expect(out.page).toBeUndefined();
    expect(out.fixes[0]?.suggestion).toEqual({
      kind: 'replace',
      statement: 'Suggested edit: replace POST /v1/charge with POST /v2/payments. Review it before you change the page.',
      untrustedReplacement: 'POST /v2/payments',
      untrustedAlternatives: ['GET /v2/payments/:param'],
      evidenceId: 'ev_00000001',
    });
    expect(svc.checkDocument).not.toHaveBeenCalled();
  });

  it('without a claim: lists only the contradicted claims of the page', async () => {
    const svc = service({ ok: true, report: makeReport([contradicted(), verified(), unknown(), { ...makeResult('c_00000004', 'contradicted'), suggestion: { kind: 'remove' } }]) });
    const out = (await createSuggestFixHandler({ service: () => svc, readPage: okPage })(ctx)) as FixEnvelope;
    expect(out.page).toEqual({ id: '123456', untrustedTitle: 'Payments API runbook', version: 7, source: 'context' });
    expect(out.counts).toEqual({ claims: 4, verified: 1, contradicted: 2, unknown: 1 });
    expect(out.fixes.map((f) => [f.claimId, f.suggestion.kind])).toEqual([['c_00000001', 'replace'], ['c_00000004', 'remove']]);
    expect(out.fixes[1]?.suggestion.statement).toBe('Suggested edit: remove or rewrite POST /v1/charge. The code has no close counterpart.');
  });

  it('gives no edit for verified and no-evidence claims, and a contradicted result without a suggestion says why', async () => {
    const svc = service({ ok: true, report: makeReport([verified(), unknown(), makeResult('c_00000005', 'contradicted')]) });
    const out = (await createSuggestFixHandler({ service: () => svc, readPage: okPage })({ claim: 'GET /v2/payments/1' })) as FixEnvelope;
    expect(out.fixes.map((f) => f.suggestion.kind)).toEqual(['none', 'none', 'none']);
    expect(out.fixes[2]?.suggestion.statement).toBe('No edit suggested: the counterpart in the code is too long to quote in full. Read it from the cited evidence.');
  });

  it('needs a page when no claim is given, and maps read and service failures', async () => {
    const svc = service({ ok: false, reason: 'rate_limited' });
    const handler = createSuggestFixHandler({ service: () => svc, readPage: okPage });
    expect(await handler({})).toMatchObject({ error: 'invalid_input' });
    expect(await handler(ctx)).toMatchObject({ error: 'rate_limited' });
    const forbidden = createSuggestFixHandler({ service: () => svc, readPage: () => Promise.resolve({ ok: false, error: 'forbidden' }) });
    expect(await forbidden(ctx)).toMatchObject({ schema: 'pil.agent.error.v1', error: 'forbidden' });
  });
});

describe('audit-space handler', () => {
  const pages = [
    { id: '1', title: 'Clean page', version: 1, adf: {} },
    { id: '2', title: 'Worst page', version: 3, adf: {} },
    { id: '3', title: 'No claims', version: 1, adf: {} },
    { id: '4', title: 'Too large', version: 1 },
    { id: '5', title: 'One contradiction', version: 2, adf: {} },
  ];
  const reports: Record<string, ClaimResult[]> = {
    '1': [verified('c_10000001'), verified('c_10000002')],
    '2': [contradicted('c_20000001'), contradicted('c_20000002'), contradicted('c_20000003'), contradicted('c_20000004'), verified('c_20000005')],
    '3': [],
    '5': [contradicted('c_50000001'), unknown('c_50000002')],
  };
  const readSpace: SpaceReader = () => Promise.resolve({ ok: true, spaceId: '98', pages, more: true });
  const svc = () => service(({ pageId }) => ({ ok: true, report: makeReport(reports[pageId ?? ''] ?? []) }));

  it('ranks pages by contradictions, worst first, with top contradictions and their proposed edits', async () => {
    const out = (await createAuditSpaceHandler({ service: svc, readSpace })(ctx)) as AuditEnvelope;
    expect(out.schema).toBe('pil.agent.audit.v1');
    expect(out.space).toEqual({ id: '98', source: 'context' });
    expect(out.scope).toEqual({ pagesRead: 5, pagesChecked: 4, pagesSkipped: 1, pagesWithoutClaims: 1, pagesNotReached: 0, maxPages: 25, morePagesInSpace: true });
    expect(out.totals).toEqual({ claims: 9, verified: 3, contradicted: 5, unknown: 1 });
    expect(out.pages.map((p) => [p.id, p.counts.contradicted, p.driftRatio])).toEqual([['2', 4, 0.8], ['5', 1, 0.5], ['1', 0, 0]]);
    expect(out.pages[0]?.untrustedTitle).toBe('Worst page');
    expect(out.pages[0]?.topContradictions).toHaveLength(3);
    expect(out.pages[0]?.topContradictions[0]).toMatchObject({ claimId: 'c_20000001', suggestion: { kind: 'replace', evidenceId: 'ev_20000001' } });
    expect(out.repo).toMatchObject({ fullName: 'acme/payments-api' });
  });

  it('stops when the time budget runs out and reports the pages it did not reach', async () => {
    let t = 0;
    const clock = { now: () => (t += 400), budgetMs: 1000 };
    const out = (await createAuditSpaceHandler({ service: svc, readSpace, clock })(ctx)) as AuditEnvelope;
    expect(out.scope).toMatchObject({ pagesRead: 5, pagesChecked: 2, pagesNotReached: 3 });
    expect(out.pages.map((p) => p.id)).toEqual(['2', '1']);
  });

  it('breaks ties by ratio and then page id', () => {
    const p = (id: string, contradictedCount: number, ratio: number): AuditedPage => ({ id, untrustedTitle: '', version: 1, counts: { claims: 4, verified: 0, contradicted: contradictedCount, unknown: 0 }, driftRatio: ratio, topContradictions: [] });
    expect(rankAudited([p('9', 1, 0.2), p('3', 1, 0.5), p('2', 1, 0.2), p('7', 2, 0.1)]).map((x) => x.id)).toEqual(['7', '3', '2', '9']);
  });

  it('stops with a typed error when no index is available or the space cannot be read', async () => {
    const missing = createAuditSpaceHandler({ service: () => service({ ok: false, reason: 'index_missing' }), readSpace });
    expect(await missing(ctx)).toMatchObject({ schema: 'pil.agent.error.v1', error: 'index_missing' });
    const forbidden = createAuditSpaceHandler({ service: svc, readSpace: () => Promise.resolve({ ok: false, error: 'forbidden' }) });
    expect(await forbidden(ctx)).toMatchObject({ error: 'forbidden' });
    expect(await createAuditSpaceHandler({ service: svc, readSpace })({})).toMatchObject({ error: 'invalid_input' });
  });

  it('reads listed pages defensively', () => {
    expect(toSpacePage({ id: '12', title: 'T', version: { number: 4 }, body: { atlas_doc_format: { value: '{"type":"doc"}' } } })).toEqual({ id: '12', title: 'T', version: 4, adf: { type: 'doc' } });
    expect(toSpacePage({ id: '12', body: { atlas_doc_format: { value: '{not json' } } })).toEqual({ id: '12', title: '', version: 0 });
    expect(toSpacePage({ id: '12', body: { atlas_doc_format: { value: 'x'.repeat(500_000) } } })?.adf).toBeUndefined();
    expect(toSpacePage({ id: '../x' })).toBeUndefined();
    expect(toSpacePage({ id: 12 })).toBeUndefined();
  });
});

describe('who to ask', () => {
  it('orders owner, last editor, creator and lists each person once', () => {
    expect(contactIds({ ownerId: 'a1', authorId: 'a1', version: { authorId: 'a2' } })).toEqual([
      { role: 'owner', accountId: 'a1' },
      { role: 'last_editor', accountId: 'a2' },
    ]);
    expect(contactIds({ authorId: '712020:0f3c-11', version: {} })).toEqual([{ role: 'creator', accountId: '712020:0f3c-11' }]);
    expect(contactIds({ ownerId: '../x', authorId: 7 })).toEqual([]);
  });

  it('cleans profile names', () => {
    expect(cleanName('  Asha\n Rao\u0007 ')).toBe('Asha Rao');
    expect(cleanName(undefined)).toBe('');
    expect(cleanName('x'.repeat(200))).toHaveLength(80);
  });

  it('suggest-fix adds whoToAsk for a page with contradictions, and omits it otherwise', async () => {
    const readContacts = vi.fn(() => Promise.resolve([{ role: 'owner' as const, accountId: 'a1', displayName: 'Asha Rao' }]));
    const withFix = createSuggestFixHandler({ service: () => service({ ok: true, report: makeReport([contradicted()]) }), readPage: okPage, readContacts });
    expect(((await withFix(ctx)) as FixEnvelope).whoToAsk).toEqual([{ role: 'owner', accountId: 'a1', untrustedDisplayName: 'Asha Rao' }]);

    const clean = createSuggestFixHandler({ service: () => service({ ok: true, report: makeReport([verified()]) }), readPage: okPage, readContacts });
    expect(((await clean(ctx)) as FixEnvelope).whoToAsk).toBeUndefined();
    expect(readContacts).toHaveBeenCalledTimes(1);

    const failing = createSuggestFixHandler({ service: () => service({ ok: true, report: makeReport([contradicted()]) }), readPage: okPage, readContacts: () => Promise.reject(new Error('x')) });
    expect(await failing(ctx)).toMatchObject({ schema: 'pil.agent.fix.v1' });
  });
});
