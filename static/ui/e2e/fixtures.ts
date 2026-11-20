/**
 * Fixture Report and ADF mirroring the demo (PLAN.md sections 9.2 and 10.2): six claims,
 * 2 verified, 3 contradicted, 1 no evidence; claim 1 is POST /v1/charge citing src/routes.ts:88.
 * Relative imports only so Playwright (Node) and Vite resolve the same files.
 */
import type { Claim, ClaimResult, ClaimType, Evidence, NormalizedClaim, Report, Verdict } from '../../../src/core/model';
import type { AuditEnvelope, AuditedPage, PageContact } from '../../../src/resolvers/contract';
import {
  contradictedCliFlagStatement,
  contradictedEnvStatement,
  contradictedRouteStatement,
  unknownStatement,
  verifiedStatement,
} from '../../../src/core/wording';

type Mark = { type: string };
interface Seg {
  text: string;
  code?: boolean;
}

interface Para {
  segs: Seg[];
}

export const SHA = '3f2c1a9d5e7b8c0a1f2e3d4c5b6a79881234abcd';
const REPO = 'himanshu748/payments-api';
const permalink = (file: string, line: number) => `https://github.com/${REPO}/blob/${SHA}/${file}#L${line}`;

export const PARAGRAPHS: Para[] = [
  { segs: [{ text: 'To take a payment, call ' }, { text: 'POST /v1/charge', code: true }, { text: ' with the amount in cents.' }] },
  { segs: [{ text: 'To look up a payment, call ' }, { text: 'GET /v2/payments/{id}', code: true }, { text: '.' }] },
  { segs: [{ text: 'Set ' }, { text: 'STRIPE_KEY', code: true }, { text: ' before starting the service.' }] },
  { segs: [{ text: 'Run ' }, { text: 'npm run db:migrate', code: true }, { text: ' before each deploy.' }] },
  { segs: [{ text: 'To force a refund, run ' }, { text: 'payments refund <paymentId> --force', code: true }, { text: '.' }] },
  { segs: [{ text: 'Reconcile with ' }, { text: 'ledgerctl reconcile --since 24h', code: true }, { text: '.' }] },
];

/** Block 0 is the heading; paragraphs are blocks 1 to 6. */
export function demoAdf(paragraphs: Para[] = PARAGRAPHS): unknown {
  return {
    type: 'doc',
    version: 1,
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Payments API runbook' }] },
      ...paragraphs.map((p) => ({
        type: 'paragraph',
        content: p.segs.map((s) => ({
          type: 'text',
          text: s.text,
          ...(s.code ? { marks: [{ type: 'code' } as Mark] } : {}),
        })),
      })),
    ],
  };
}

function claim(index: number, type: ClaimType, normalized: NormalizedClaim): Claim {
  const para = PARAGRAPHS[index] as Para;
  const text = para.segs.map((s) => s.text).join('');
  const raw = (para.segs.find((s) => s.code) as Seg).text;
  const start = text.indexOf(raw);
  return {
    id: `c_0000000${index + 1}`,
    type,
    raw,
    normalized,
    location: { blockIndex: index + 1, start, end: start + raw.length },
    confidence: 'high',
  };
}

function ev(id: string, kind: Evidence['kind'], file: string, line: number, snippet: string): Evidence {
  return { id, kind, file, line, snippet, permalink: permalink(file, line) };
}

function result(
  c: Claim,
  verdict: Verdict,
  reason: ClaimResult['reason'],
  statement: string,
  evidence: Evidence[],
  suggestion?: ClaimResult['suggestion'],
): ClaimResult {
  return { claim: c, verdict, reason, statement, evidence, ...(suggestion ? { suggestion } : {}) };
}

export function demoReport(overrides: Partial<Report> = {}): Report {
  const results: ClaimResult[] = [
    result(
      claim(0, 'http_endpoint', { type: 'http_endpoint', method: 'POST', path: '/v1/charge' }),
      'contradicted',
      'route_absent_nearest',
      contradictedRouteStatement({ claim: 'POST /v1/charge', nearest: { text: 'POST /v2/payments', file: 'src/routes.ts', line: 88 } }),
      [ev('ev_9f2c0e11', 'nearest', 'src/routes.ts', 88, "router.post('/v2/payments', createPayment);")],
      { kind: 'replace', replacement: 'POST /v2/payments', evidenceId: 'ev_9f2c0e11' },
    ),
    result(
      claim(1, 'http_endpoint', { type: 'http_endpoint', method: 'GET', path: '/v2/payments/:param' }),
      'verified',
      'route_exact',
      verifiedStatement({ claim: 'GET /v2/payments/{id}', file: 'src/routes.ts', line: 96 }),
      [ev('ev_1a2b3c4d', 'match', 'src/routes.ts', 96, "router.get('/v2/payments/:id', getPayment);")],
    ),
    result(
      claim(2, 'env_var', { type: 'env_var', name: 'STRIPE_KEY' }),
      'contradicted',
      'env_not_read',
      contradictedEnvStatement({ name: 'STRIPE_KEY', repo: REPO, sha: SHA, nearest: { name: 'PAYMENTS_API_KEY', file: 'src/config.ts', line: 4 } }),
      [ev('ev_5d6e7f80', 'nearest', 'src/config.ts', 4, 'apiKey: process.env.PAYMENTS_API_KEY,')],
      { kind: 'replace', replacement: 'PAYMENTS_API_KEY', evidenceId: 'ev_5d6e7f80' },
    ),
    result(
      claim(3, 'cli', { type: 'cli', program: 'npm', subcommands: ['run', 'db:migrate'], flags: [] }),
      'verified',
      'script_defined',
      verifiedStatement({ claim: 'npm run db:migrate', file: 'package.json', line: 9 }),
      [ev('ev_a1b2c3d4', 'match', 'package.json', 9, '"db:migrate": "node dist/migrate.js",')],
    ),
    result(
      claim(4, 'cli', { type: 'cli', program: 'payments', subcommands: ['refund'], flags: ['--force'] }),
      'contradicted',
      'cli_flag_not_defined',
      contradictedCliFlagStatement({ program: 'payments', subcommand: 'refund', flag: '--force', defined: ['--confirm', '--reason'], file: 'src/cli.ts', line: 21 }),
      [ev('ev_e5f6a7b8', 'nearest', 'src/cli.ts', 21, ".command('refund <paymentId>')")],
      { kind: 'replace', replacement: 'payments refund', evidenceId: 'ev_e5f6a7b8', alternatives: ['payments refund --confirm', 'payments refund --reason'] },
    ),
    result(
      claim(5, 'cli', { type: 'cli', program: 'ledgerctl', subcommands: ['reconcile'], flags: ['--since'] }),
      'unknown',
      'program_not_in_repo',
      unknownStatement({ reason: 'ledgerctl is not defined in this repository' }),
      [],
    ),
  ];
  return {
    schema: 'pil.report.v1',
    repo: { provider: 'github', fullName: REPO, ref: 'main', sha: SHA, indexedAt: '2026-12-01T10:00:00Z' },
    stale: false,
    counts: { claims: 6, verified: 2, contradicted: 3, unknown: 1 },
    limits: {
      maxClaims: 200,
      claimsTruncated: false,
      filesIndexed: 14,
      filesSkipped: 0,
      indexTruncated: false,
      coverage: { routes: 'complete', env: 'complete', cli: 'partial', config: 'none', files: 'complete', packages: 'complete' },
    },
    results,
    ...overrides,
  };
}

export const demoContacts: PageContact[] = [
  { role: 'owner', accountId: '712020:aaaa', displayName: 'Asha Rao' },
  { role: 'last_editor', accountId: '712020:bbbb', displayName: 'Ben Ito' },
];

/** Space audit over three pages: the runbook (3 contradicted), a deploy guide (1) and a clean page. */
export function demoAudit(): AuditEnvelope {
  const report = demoReport();
  const fix = (r: ClaimResult): AuditedPage['topContradictions'][number] => ({
    claimId: r.claim.id,
    type: r.claim.type,
    untrustedClaimText: r.claim.raw,
    verdict: r.verdict,
    statement: r.statement,
    evidence: r.evidence.map((e) => ({ id: e.id, kind: e.kind, ...(e.file ? { file: e.file } : {}), ...(e.line ? { line: e.line } : {}), ...(e.permalink ? { permalink: e.permalink } : {}) })),
    suggestion: {
      kind: r.suggestion?.kind ?? 'remove',
      statement: '',
      ...(r.suggestion?.replacement ? { untrustedReplacement: r.suggestion.replacement } : {}),
      ...(r.suggestion?.evidenceId ? { evidenceId: r.suggestion.evidenceId } : {}),
    },
  });
  const contradicted = report.results.filter((r) => r.verdict === 'contradicted');
  return {
    schema: 'pil.agent.audit.v1',
    dataNotice: '',
    space: { id: '98', source: 'context' },
    repo: { fullName: REPO, ref: 'main', sha: SHA, indexedAt: '2026-12-01T10:00:00Z', stale: false },
    scope: { pagesRead: 6, pagesChecked: 5, pagesSkipped: 1, pagesWithoutClaims: 2, maxPages: 25, morePagesInSpace: false },
    totals: { claims: 14, verified: 8, contradicted: 4, unknown: 2 },
    pages: [
      { id: '123456', untrustedTitle: 'Payments API runbook', version: 7, counts: report.counts, driftRatio: 0.5, topContradictions: contradicted.map(fix) },
      {
        id: '123457',
        untrustedTitle: 'Deploy guide',
        version: 3,
        counts: { claims: 4, verified: 2, contradicted: 1, unknown: 1 },
        driftRatio: 0.25,
        topContradictions: contradicted.slice(1, 2).map(fix),
      },
      { id: '123458', untrustedTitle: 'On-call checklist', version: 2, counts: { claims: 4, verified: 4, contradicted: 0, unknown: 0 }, driftRatio: 0, topContradictions: [] },
    ],
  };
}
