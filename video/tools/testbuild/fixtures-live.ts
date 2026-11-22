/**
 * Fixture override for the demo video: the same six claims as the e2e fixtures, but with the values
 * the live check returned for himanshu748/payments-api-demo@0383355 (MCP check-page output, 2026-11-16),
 * so the card and the Jira draft captured from the local test build cite the real files, lines and ids.
 */
import type { Evidence, Report } from '../../../src/core/model';
import {
  contradictedCliFlagStatement,
  contradictedEnvStatement,
  contradictedRouteStatement,
  unknownStatement,
  verifiedStatement,
} from '../../../src/core/wording';
import { demoReport as baseReport } from '../../../static/ui/e2e/fixtures';

export { demoAdf } from '../../../static/ui/e2e/fixtures';

const SHA = '0383355b12b30050b85cb6b914e970660b92bc2a';
const REPO = 'himanshu748/payments-api-demo';
const ev = (id: string, kind: Evidence['kind'], file: string, line: number, snippet: string): Evidence => ({
  id,
  kind,
  file,
  line,
  snippet,
  permalink: `https://github.com/${REPO}/blob/${SHA}/${file}#L${line}`,
});

export function demoReport(overrides: Partial<Report> = {}): Report {
  const base = baseReport();
  const [r1, r2, r3, r4, r5, r6] = base.results;
  if (!r1 || !r2 || !r3 || !r4 || !r5 || !r6) throw new Error('expected six fixture results');
  const results = [
    {
      ...r1,
      statement: contradictedRouteStatement({ claim: 'POST /v1/charge', nearest: { text: 'POST /v2/payments', file: 'src/routes.ts', line: 88 } }),
      evidence: [ev('ev_39dd3751', 'nearest', 'src/routes.ts', 88, "router.post('/v2/payments', createPayment);")],
    },
    {
      ...r2,
      statement: verifiedStatement({ claim: 'GET /v2/payments/:param', file: 'src/routes.ts', line: 92 }),
      evidence: [ev('ev_96b0428d', 'match', 'src/routes.ts', 92, "router.get('/v2/payments/:id', getPayment);")],
    },
    {
      ...r3,
      statement: contradictedEnvStatement({ name: 'STRIPE_KEY', repo: REPO, sha: SHA, nearest: { name: 'PAYMENTS_API_KEY', file: 'src/config.ts', line: 8 } }),
      evidence: [ev('ev_7659c2e1', 'nearest', 'src/config.ts', 8, 'const apiKey = process.env.PAYMENTS_API_KEY;')],
    },
    {
      ...r4,
      statement: verifiedStatement({ claim: 'npm run db:migrate', file: 'package.json', line: 18 }),
      evidence: [ev('ev_bf48965b', 'match', 'package.json', 18, '"db:migrate": "node dist/migrate.js"')],
    },
    {
      ...r5,
      statement: contradictedCliFlagStatement({
        program: 'payments',
        subcommand: 'refund',
        flag: '--force',
        defined: ['--confirm', '--reason', '--help', '-h'],
        file: 'src/cli.ts',
        line: 10,
      }),
      evidence: [ev('ev_af6bf648', 'nearest', 'src/cli.ts', 10, ".command('refund <paymentId>')")],
    },
    { ...r6, statement: unknownStatement({ reason: 'the program is not defined in this repository' }), evidence: [] },
  ];
  return {
    ...base,
    repo: { ...base.repo, sha: SHA, indexedAt: '2026-11-16T17:14:07Z' },
    limits: {
      ...base.limits,
      filesIndexed: 9,
      filesSkipped: 1,
      coverage: { routes: 'complete', env: 'complete', cli: 'complete', config: 'none', files: 'complete', packages: 'complete' },
    },
    results,
    ...overrides,
  };
}
