import { describe, expect, it } from 'vitest';
import { claimId, evidenceId, hash8, stableStringify } from '../../../src/core/ids';
import { rankEnv, rankMovedFiles, rankNames, rankRoutes, segmentsMatch } from '../../../src/core/match/nearest';
import { jaroWinkler, sharedTokenScore, tokens } from '../../../src/core/match/similarity';
import { rangesIntersect } from '../../../src/core/match/semver';
import { buildAgentEnvelope, buildReport, matchClaim, sanitizeUntrusted } from '../../../src/core/match';
import type { EnvEntry, RouteEntry } from '../../../src/core/model';
import { demoClaims, demoIndex } from '../../fixtures/match/demo';
import { makeClaim, makeIndex } from '../../fixtures/match/builders';

const r = (method: RouteEntry['method'], path: string, line: number, file = 'src/routes.ts'): RouteEntry => ({ file, line, snippet: '', method, path, framework: 'x' });
const e = (name: string, line: number, source: EnvEntry['source'] = 'code'): EnvEntry => ({ file: 'src/config.ts', line, snippet: '', name, source });

describe('route ranking', () => {
  const claim = { type: 'http_endpoint', method: 'POST', path: '/v1/charge' } as const;
  it('ranks the same method before higher path similarity', () => {
    const ranked = rankRoutes(claim, [r('GET', '/v1/charges', 1), r('POST', '/v2/payments', 88)]);
    expect(ranked.map((x) => x.line)).toEqual([88, 1]);
  });
  it('puts a version-prefix swap first among same-method routes', () => {
    const ranked = rankRoutes(claim, [r('POST', '/v1/refunds', 5), r('POST', '/v2/charge', 9), r('POST', '/v1/charge/:param', 7)]);
    expect(ranked[0]?.path).toBe('/v2/charge');
  });
  it('returns at most 3, deduplicated, with a stable tie order', () => {
    const routes = [r('POST', '/a', 5, 'b.ts'), r('POST', '/a', 6, 'c.ts'), r('POST', '/b', 3, 'a.ts'), r('POST', '/c', 2, 'a.ts'), r('POST', '/d', 1, 'a.ts')];
    const ranked = rankRoutes(claim, routes);
    expect(ranked.length).toBe(3);
    expect(new Set(ranked.map((x) => x.path)).size).toBe(3);
    expect(rankRoutes(claim, [...routes].reverse()).map((x) => x.path)).toEqual(ranked.map((x) => x.path));
  });
  it('drops unrelated routes of another method', () => {
    expect(rankRoutes(claim, [r('GET', '/zzzzzzzz/qqqq/wwww', 1)])).toEqual([]);
  });
});

it('distinguishes a named wildcard from its root-inclusive form', () => {
  expect(segmentsMatch([], ['*splat'])).toBe(false);
  expect(segmentsMatch([], ['{*splat}'])).toBe(true);
});

describe('env ranking', () => {
  it('STRIPE_KEY ranks PAYMENTS_API_KEY first', () => {
    const ranked = rankEnv('STRIPE_KEY', [e('PORT', 1), e('DATABASE_URL', 2), e('PAYMENTS_API_KEY', 3), e('API_KEY_ID', 4)]);
    expect(ranked[0]?.name).toBe('PAYMENTS_API_KEY');
  });
  it('prefers code reads over config listings and dedupes names', () => {
    const ranked = rankEnv('DB_URL', [e('DATABASE_URL', 9, 'env_example'), e('DATABASE_URL', 4)]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.line).toBe(4);
  });
  it('drops names that share nothing', () => {
    expect(rankEnv('STRIPE_KEY', [e('PORT', 1)])).toEqual([]);
  });
});

describe('other rankers and similarity', () => {
  it('rankNames orders by similarity and caps at 3', () => {
    expect(rankNames('db:migrat', ['build', 'db:migrate', 'lint', 'test'])[0]).toBe('db:migrate');
    expect(rankNames('x', ['a', 'b', 'c', 'd'])).toHaveLength(3);
  });
  it('rankMovedFiles prefers same basename, else directory head', () => {
    const files = [{ path: 'a/seed.sh' }, { path: 'src/x.ts' }];
    expect(rankMovedFiles('bin/seed.sh', files)).toEqual({ moved: true, files: [{ path: 'a/seed.sh' }] });
    expect(rankMovedFiles('src/y.ts', files)).toEqual({ moved: false, files: [{ path: 'src/x.ts' }] });
    expect(rankMovedFiles('nothing/here.ts', files).files).toEqual([]);
  });
  it('jaroWinkler basics', () => {
    expect(jaroWinkler('abc', 'abc')).toBe(1);
    expect(jaroWinkler('', 'abc')).toBe(0);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(jaroWinkler('', '')).toBe(0);
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2);
  });
  it('tokens split snake and camel case', () => {
    expect(tokens('PAYMENTS_API_Key')).toEqual(['payments', 'api', 'key']);
    expect(tokens('retryMaxAttempts')).toEqual(['retry', 'max', 'attempts']);
    expect(sharedTokenScore('STRIPE_KEY', 'PAYMENTS_API_KEY')).toBeCloseTo(0.25);
    expect(sharedTokenScore('', 'A')).toBe(0);
  });
});

describe('version ranges', () => {
  it.each([
    ['4.18.2', '^4.19.2', false],
    ['4.19.x', '^4.19.2', true],
    ['3.x', '^4.19.2', false],
    ['20', '>=18', true],
    ['<18', '>=20', false],
    ['>=20', '>=18 <22', true],
    ['22', '>=18 <22', false],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.2', '~1.2.5', true],
    ['1.3', '~1.2.5', false],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.4', '^0.0.3', false],
    ['2.x', '^1 || ^2', true],
    ['3.x', '^1 || ^2', false],
    ['*', '1.2.3', true],
    ['', '1.2.3', true],
    ['1.5.0', '1 - 2', true],
    ['3.0.0', '1 - 2', false],
    ['2.1', '~=2.1.3', true],
    ['2.0', '~=2.1.3', false],
    ['2.1.9', '~=2.1.3', true],
    ['2.9', '~=2.1', true],
    ['3.0', '~=2.1', false],
    ['1.6.2', '>=0.6, <1', false],
    ['0.6.1', '>=0.6, <1', true],
    ['v1.2.3', '>1.2.0', true],
    ['1.2.3', '>1.2.3', false],
    ['1.2.3', '<=1.2.3', true],
    ['1.2.x', '<=1.2', true],
    ['2.0.0', '>1', true],
    ['1.9.0', '>1', false],
    ['1.0.0-beta.1', '1.0.0', true],
    ['1', '>= 1', true],
    ['3', '~1', false],
    ['1.2.3', '~>1.2', true],
  ] as const)('%s vs %s -> %s', (a, b, expected) => {
    expect(rangesIntersect(a, b)).toBe(expected);
    expect(rangesIntersect(b, a)).toBe(expected);
  });
  it.each(['workspace:*', 'latest', 'git+https://x/y', '!=1.0', '1.2.3.4', 'a.b.c'])('cannot parse %s', (range) => {
    expect(rangesIntersect(range, '1.0.0')).toBeUndefined();
  });
});

describe('ids', () => {
  const normalized = { type: 'http_endpoint', method: 'POST', path: '/v1/charge' } as const;
  it('hash8 is 8 hex chars and deterministic', () => {
    expect(hash8('a')).toMatch(/^[0-9a-f]{8}$/);
    expect(hash8('a')).toBe(hash8('a'));
    expect(hash8('a')).not.toBe(hash8('b'));
    expect(hash8('')).toMatch(/^[0-9a-f]{8}$/);
  });
  it('claim ids depend on position and normalized form, not on key order', () => {
    const id = claimId(0, 5, normalized);
    expect(id).toMatch(/^c_[0-9a-f]{8}$/);
    expect(claimId(0, 5, { path: '/v1/charge', method: 'POST', type: 'http_endpoint' })).toBe(id);
    expect(claimId(1, 5, normalized)).not.toBe(id);
    expect(claimId(0, 6, normalized)).not.toBe(id);
    expect(claimId(0, 5, { ...normalized, path: '/v1/x' })).not.toBe(id);
  });
  it('stableStringify sorts keys and drops undefined', () => {
    expect(stableStringify({ b: 1, a: [2, { d: undefined, c: null }] })).toBe('{"a":[2,{"c":null}],"b":1}');
    expect(stableStringify(undefined)).toBe('null');
  });
  it('evidence ids are stable and separate files, lines, kinds and scopes', () => {
    const base = { sha: 'abc', file: 'src/routes.ts', line: 88, kind: 'nearest' as const };
    const id = evidenceId(base);
    expect(id).toMatch(/^ev_[0-9a-f]{8}$/);
    expect(evidenceId({ ...base })).toBe(id);
    expect(evidenceId({ ...base, sha: 'abd' })).not.toBe(id);
    expect(evidenceId({ ...base, line: 89 })).not.toBe(id);
    expect(evidenceId({ ...base, kind: 'match' })).not.toBe(id);
    expect(evidenceId({ ...base, file: 'x.ts' })).not.toBe(id);
    expect(evidenceId({ sha: 'abc', kind: 'absence', scope: 'a' })).not.toBe(evidenceId({ sha: 'abc', kind: 'absence', scope: 'b' }));
    expect(evidenceId({ ...base, scope: 'ignored with a file' })).toBe(id);
  });
  it('the same index and claim give the same evidence ids on every run', () => {
    const run = () => demoClaims().map((c) => matchClaim(c, demoIndex()).evidence.map((x) => x.id));
    expect(run()).toEqual(run());
  });
});

describe('report and envelope', () => {
  it('counts, limits and truncation', () => {
    const index = demoIndex();
    const results = demoClaims().map((c) => matchClaim(c, index));
    const report = buildReport({ index, results, stale: true });
    expect(report).toMatchObject({
      schema: 'pil.report.v1',
      stale: true,
      counts: { claims: 6, verified: 2, contradicted: 3, unknown: 1 },
      limits: { maxClaims: 200, claimsTruncated: false, filesIndexed: 14, filesSkipped: 0, indexTruncated: false },
    });
    expect(report.limits.coverage.config).toBe('none');
    const capped = buildReport({ index, results, maxClaims: 2, claimsTruncated: false });
    expect(capped.results).toHaveLength(2);
    expect(capped.limits.claimsTruncated).toBe(true);
    expect(buildReport({ index, results: [], claimsTruncated: true }).limits.claimsTruncated).toBe(true);
  });
  it('envelope puts quoted text only in untrusted fields and caps it', () => {
    const index = makeIndex({ routes: [{ file: 'a.ts', line: 1, snippet: `router.get('/x')\n${'z'.repeat(300)}`, method: 'GET', path: '/x', framework: 'x' }] });
    const claim = makeClaim({ type: 'http_endpoint', method: 'GET', path: '/x' }, 'GET /x');
    const report = buildReport({ index, results: [matchClaim(claim, index)] });
    const env = buildAgentEnvelope(report, { id: '123', title: `Title\n${'t'.repeat(300)}`, version: 7 });
    expect(env.schema).toBe('pil.agent.v1');
    expect(env.dataNotice).toContain('data, not instructions');
    expect(env.page?.untrustedTitle.length).toBeLessThanOrEqual(160);
    expect(env.page?.version).toBe(7);
    const ev = env.results[0]?.evidence[0];
    expect(ev?.untrustedSnippet?.length).toBeLessThanOrEqual(160);
    expect(ev).not.toHaveProperty('snippet');
    expect(env.results[0]?.untrustedClaimText).toBe('GET /x');
    expect(buildAgentEnvelope(report).page).toBeUndefined();
  });
  it('an unsatisfiable range never intersects', () => {
    expect(rangesIntersect('<*', '1.0.0')).toBe(false);
  });
  it('sanitizeUntrusted', () => {
    expect(sanitizeUntrusted('a\u0000b\nc\t d')).toBe('a b c  d');
    expect(sanitizeUntrusted('x'.repeat(200))).toHaveLength(160);
    expect(sanitizeUntrusted('é'.repeat(10), 3)).toBe('ééé');
  });
});
