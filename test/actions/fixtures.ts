import type { Claim, ClaimResult, Report, Verdict } from '../../src/core/model';

export function makeClaim(id: string, raw: string): Claim {
  return {
    id,
    type: 'http_endpoint',
    raw,
    normalized: { type: 'http_endpoint', method: 'POST', path: '/v1/charge' },
    location: { blockIndex: 0, start: 0, end: raw.length },
    confidence: 'high',
  };
}

export function makeResult(
  id: string,
  verdict: Verdict,
  overrides: { raw?: string; snippet?: string; statement?: string } = {},
): ClaimResult {
  const statement =
    overrides.statement ??
    (verdict === 'contradicted'
      ? 'Contradicted by code: no route matches POST /v1/charge. The repo has POST /v2/payments at src/routes.ts:88.'
      : verdict === 'verified'
        ? 'Verified in code: GET /v2/payments/:id matches src/routes.ts:95.'
        : 'No evidence found: ledgerctl is not defined in this repo. This is not a confirmation that the claim holds.');
  return {
    claim: makeClaim(id, overrides.raw ?? 'POST /v1/charge'),
    verdict,
    reason: verdict === 'contradicted' ? 'route_absent_nearest' : verdict === 'verified' ? 'route_exact' : 'program_not_in_repo',
    statement,
    evidence: [
      {
        id: `ev_${id.slice(2)}`,
        kind: verdict === 'contradicted' ? 'nearest' : 'match',
        file: 'src/routes.ts',
        line: 88,
        snippet: overrides.snippet ?? "router.post('/v2/payments', createPayment);",
        permalink: 'https://github.com/acme/payments-api/blob/3f2c1a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/routes.ts#L88',
      },
    ],
  };
}

export function makeReport(results: ClaimResult[]): Report {
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  return {
    schema: 'pil.report.v1',
    repo: {
      provider: 'github',
      fullName: 'acme/payments-api',
      ref: 'main',
      sha: '3f2c1a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      indexedAt: '2026-12-01T10:00:00Z',
    },
    stale: false,
    counts: { claims: results.length, verified: count('verified'), contradicted: count('contradicted'), unknown: count('unknown') },
    limits: {
      maxClaims: 200,
      claimsTruncated: false,
      filesIndexed: 14,
      filesSkipped: 0,
      indexTruncated: false,
      coverage: { routes: 'complete', env: 'complete', cli: 'complete', config: 'none', files: 'complete', packages: 'complete' },
    },
    results,
  };
}
