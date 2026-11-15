import { describe, expect, it } from 'vitest';
import type { Claim, ClaimResult } from '../../src/core/model';
import { checkDocument, type CheckDeps } from '../../src/service/check';
import { demoClaims, demoIndex, INJECTION_PAGE_TEXT, INJECTION_REPO_COMMENT } from '../fixtures/match/demo';

function depsFor(claims: Claim[], injectedRepo = false): CheckDeps {
  return {
    indexLoader: { loadIndex: async () => ({ ok: true, index: demoIndex({ injected: injectedRepo }), stale: false }) },
    extractor: { extractClaims: () => ({ claims, truncated: false }), extractClaimsFromText: () => ({ claims, truncated: false }) },
    clock: { now: () => new Date('2026-12-01T12:00:00.000Z') },
  };
}

async function run(claims: Claim[], injectedRepo = false) {
  const out = await checkDocument(depsFor(claims, injectedRepo), { adf: { type: 'doc' } });
  if (!out.ok) throw new Error(out.message);
  return out.report;
}

const verdicts = (results: ClaimResult[]) => results.map((r) => r.verdict);

describe('demo golden (PLAN.md 10.2), hand-made Claim[] and RepoIndex', () => {
  it('broken runbook: 2 verified, 3 contradicted, 1 no evidence', async () => {
    const report = await run(demoClaims());
    expect(report.counts).toEqual({ claims: 6, verified: 2, contradicted: 3, unknown: 1 });
    expect(verdicts(report.results)).toEqual(['contradicted', 'verified', 'contradicted', 'verified', 'contradicted', 'unknown']);
  });

  it('claim 1 POST /v1/charge cites src/routes.ts:88 with nearest POST /v2/payments', async () => {
    const [first] = (await run(demoClaims())).results;
    expect(first?.reason).toBe('route_absent_nearest');
    expect(first?.evidence[0]).toMatchObject({
      kind: 'nearest',
      file: 'src/routes.ts',
      line: 88,
      permalink: 'https://github.com/himanshu748/payments-api/blob/3f2c1a9d0e5b7c8a1b2c3d4e5f60718293a4b5c6/src/routes.ts#L88',
    });
    expect(first?.statement).toBe('Contradicted by code: no route matches POST /v1/charge. The repo has POST /v2/payments at src/routes.ts:88.');
  });

  it('cites the other evidence of the demo', async () => {
    const r = (await run(demoClaims())).results;
    expect(r[1]?.evidence[0]).toMatchObject({ file: 'src/routes.ts', line: 92 });
    expect(r[2]?.statement).toContain('The code reads PAYMENTS_API_KEY at src/config.ts:4.');
    expect(r[3]?.evidence[0]).toMatchObject({ file: 'package.json', line: 10 });
    expect(r[4]?.statement).toBe('Contradicted by code: payments refund does not define --force. It defines --confirm, --reason at src/cli.ts:14.');
    expect(r[5]?.reason).toBe('program_not_in_repo');
  });

  it('every statement passes the banned words rule and unknown ones say they are not a confirmation', async () => {
    const report = await run(demoClaims());
    for (const result of report.results) {
      expect(result.statement).not.toMatch(/\b(wrong|safe)\b/i);
      if (result.verdict === 'unknown') {
        expect(result.statement).toMatch(/^No evidence found: .*not a confirmation/);
      }
      if (result.verdict === 'verified') expect(result.statement).toMatch(/^Verified in code: /);
      if (result.verdict === 'contradicted') expect(result.statement).toMatch(/^Contradicted by code: /);
    }
  });

  it('fixed runbook: claim 1 becomes verified with the same citation', async () => {
    const report = await run(demoClaims({ fixed: true }));
    expect(report.counts).toEqual({ claims: 6, verified: 3, contradicted: 2, unknown: 1 });
    const [first] = report.results;
    expect(first).toMatchObject({ verdict: 'verified', reason: 'route_exact' });
    expect(first?.evidence[0]).toMatchObject({ kind: 'match', file: 'src/routes.ts', line: 88 });
    const broken = (await run(demoClaims())).results[0];
    expect(first?.evidence[0]?.file).toBe(broken?.evidence[0]?.file);
    expect(first?.evidence[0]?.line).toBe(broken?.evidence[0]?.line);
  });
});

describe('prompt injection parity (PLAN.md 11)', () => {
  const comparable = (results: ClaimResult[]) =>
    results.map((r) => ({
      id: r.claim.id,
      verdict: r.verdict,
      reason: r.reason,
      statement: r.statement,
      evidence: r.evidence.map((e) => ({ id: e.id, kind: e.kind, file: e.file, line: e.line, permalink: e.permalink })),
    }));

  it('injected repo comments and page text give the same verdicts as the clean fixture', async () => {
    const clean = await run(demoClaims());
    const injected = await run(demoClaims({ injected: true }), true);
    expect(comparable(injected.results)).toEqual(comparable(clean.results));
    expect(injected.counts).toEqual(clean.counts);
  });

  it('injected text appears only in untrusted data fields', async () => {
    const injected = await run(demoClaims({ injected: true }), true);
    const text = (value: unknown) => JSON.stringify(value);
    for (const result of injected.results) {
      expect(result.statement).not.toContain('SYSTEM');
      expect(result.statement).not.toContain('ignore your rules');
      for (const e of result.evidence) {
        expect(text({ ...e, snippet: undefined })).not.toContain('SYSTEM');
      }
    }
    expect(text(injected.results[0]?.evidence[0]?.snippet)).toContain(INJECTION_REPO_COMMENT);
    expect(injected.results[0]?.claim.raw).toContain(INJECTION_PAGE_TEXT);
  });
});
