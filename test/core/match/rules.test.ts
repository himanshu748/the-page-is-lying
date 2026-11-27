import { describe, expect, it } from 'vitest';
import { matchClaim } from '../../../src/core/match';
import type { ClaimResult, NormalizedClaim, RepoIndex } from '../../../src/core/model';
import { makeClaim, makeIndex } from '../../fixtures/match/builders';

const hasControl = (text: string): boolean => Array.from(text).some((ch) => ch.charCodeAt(0) < 32);
const loc = (file: string, line: number, snippet = 'x') => ({ file, line, snippet });

function check(normalized: NormalizedClaim, index: RepoIndex, options = {}): ClaimResult {
  return matchClaim(makeClaim(normalized, 'raw text'), index, options);
}

const route = (method: 'GET' | 'POST' | 'ANY', path: string, line: number) => ({
  ...loc('src/routes.ts', line),
  method,
  path,
  framework: 'express',
});

const isUnknownStatement = (r: ClaimResult) => {
  expect(r.verdict).toBe('unknown');
  expect(r.statement).toContain('No evidence found');
  expect(r.statement).toContain('not a confirmation');
};

describe('http_endpoint rules (7.2)', () => {
  const index = makeIndex({ routes: [route('POST', '/v2/payments', 88), route('GET', '/v2/payments/:param', 92), route('ANY', '/ping', 3)] });

  it('verified: same method and path', () => {
    const r = check({ type: 'http_endpoint', method: 'POST', path: '/v2/payments' }, index);
    expect(r).toMatchObject({ verdict: 'verified', reason: 'route_exact' });
    expect(r.evidence[0]).toMatchObject({ kind: 'match', file: 'src/routes.ts', line: 88 });
    expect(r.statement).toBe('Verified in code: POST /v2/payments matches src/routes.ts:88.');
  });
  it('verified: any method when the claim has none', () => {
    expect(check({ type: 'http_endpoint', method: 'ANY', path: '/v2/payments' }, index)).toMatchObject({ verdict: 'verified', reason: 'route_any_method' });
  });
  it('verified: route registered for all methods', () => {
    expect(check({ type: 'http_endpoint', method: 'DELETE', path: '/ping' }, index).verdict).toBe('verified');
  });
  it('verified: params match any route parameter name', () => {
    expect(check({ type: 'http_endpoint', method: 'GET', path: '/v2/payments/:param' }, index).verdict).toBe('verified');
    expect(check({ type: 'http_endpoint', method: 'GET', path: '/v2/payments/123' }, index).verdict).toBe('verified');
  });
  it('keeps an Express-shaped GET route without confirmed HEAD support unknown', () => {
    const r = check({ type: 'http_endpoint', method: 'HEAD', path: '/v2/payments/123' }, index);
    expect(r).toMatchObject({ verdict: 'unknown', reason: 'route_head_unconfirmed', evidence: [{ line: 92 }] });
  });
  it('does not infer HEAD from an OpenAPI GET operation', () => {
    const declared = makeIndex({ routes: [{ ...route('GET', '/health', 12), framework: 'openapi' }] });
    expect(check({ type: 'http_endpoint', method: 'HEAD', path: '/health' }, declared).verdict).toBe('contradicted');
  });
  it('contradicted: complete coverage, no route, cites nearest', () => {
    const r = check({ type: 'http_endpoint', method: 'POST', path: '/v1/charge' }, index);
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'route_absent_nearest' });
    expect(r.evidence[0]).toMatchObject({ kind: 'nearest', file: 'src/routes.ts', line: 88 });
    expect(r.statement).toBe('Contradicted by code: no route matches POST /v1/charge. The repo has POST /v2/payments at src/routes.ts:88.');
  });
  it('contradicted: wrong method on an existing path', () => {
    const r = check({ type: 'http_endpoint', method: 'GET', path: '/v2/payments' }, index);
    expect(r.verdict).toBe('contradicted');
    expect(r.evidence[0]?.line).toBe(88);
    expect(r.statement).toContain('The repo has POST /v2/payments');
  });
  it('stays unknown when an indexed path has another method under partial coverage', () => {
    const partial = makeIndex({ coverage: { routes: 'partial' }, routes: index.routes });
    const r = check({ type: 'http_endpoint', method: 'GET', path: '/v2/payments' }, partial);
    expect(r).toMatchObject({ verdict: 'unknown', reason: 'coverage_partial' });
  });
  it('contradicted without any alternative uses route_absent', () => {
    const r = check({ type: 'http_endpoint', method: 'POST', path: '/x' }, makeIndex({ routes: [] }));
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'route_absent' });
    expect(r.statement).toContain('no route matches POST /x');
  });
  it.each(['partial', 'none'] as const)('unknown when routes coverage is %s', (coverage) => {
    const r = check({ type: 'http_endpoint', method: 'POST', path: '/v1/charge' }, makeIndex({ coverage: { routes: coverage }, routes: index.routes }));
    isUnknownStatement(r);
    expect(r.reason).toBe(coverage === 'none' ? 'coverage_none' : 'coverage_partial');
    expect(r.evidence.some((e) => e.kind === 'coverage')).toBe(true);
  });
  it('still verified on partial coverage when a route matches', () => {
    expect(check({ type: 'http_endpoint', method: 'POST', path: '/v2/payments' }, makeIndex({ coverage: { routes: 'partial' }, routes: index.routes })).verdict).toBe('verified');
  });
  it('unknown for an external host, checked for a configured service host', () => {
    const claim: NormalizedClaim = { type: 'http_endpoint', method: 'POST', path: '/v2/payments', host: 'api.example.com' };
    const external = check(claim, index);
    isUnknownStatement(external);
    expect(external.reason).toBe('external_host');
    expect(check(claim, index, { serviceHosts: ['API.example.com'] }).verdict).toBe('verified');
  });
});

describe('env_var rules (7.2)', () => {
  const index = makeIndex({
    env: [
      { ...loc('src/config.ts', 4), name: 'PAYMENTS_API_KEY', source: 'code' },
      { ...loc('.env.example', 2), name: 'ONLY_LISTED', source: 'env_example' },
      { ...loc('src/config.ts', 5), name: 'DATABASE_URL', source: 'code' },
    ],
  });
  it('verified: read in code', () => {
    const r = check({ type: 'env_var', name: 'PAYMENTS_API_KEY' }, index);
    expect(r).toMatchObject({ verdict: 'verified', reason: 'env_read_in_code' });
  });
  it('verified: listed in config only', () => {
    expect(check({ type: 'env_var', name: 'ONLY_LISTED' }, index)).toMatchObject({ verdict: 'verified', reason: 'env_listed_in_config' });
  });
  it('contradicted: STRIPE_KEY cites PAYMENTS_API_KEY', () => {
    const r = check({ type: 'env_var', name: 'STRIPE_KEY' }, index);
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'env_not_read' });
    expect(r.evidence[0]).toMatchObject({ kind: 'nearest', file: 'src/config.ts', line: 4 });
    expect(r.statement).toBe('Contradicted by code: STRIPE_KEY is not read anywhere in himanshu748/payments-api@3f2c1a9. The code reads PAYMENTS_API_KEY at src/config.ts:4.');
  });
  it('contradicted without a similar name has no nearest sentence', () => {
    const r = check({ type: 'env_var', name: 'ZZZ' }, makeIndex({ env: [{ ...loc('a.ts', 1), name: 'PORT', source: 'code' }] }));
    expect(r.verdict).toBe('contradicted');
    expect(r.statement).not.toContain('The code reads');
  });
  it.each(['partial', 'none'] as const)('unknown when env coverage is %s', (coverage) => {
    isUnknownStatement(check({ type: 'env_var', name: 'STRIPE_KEY' }, makeIndex({ coverage: { env: coverage }, env: index.env })));
  });
  it('unknown when a complete index has no static read at all', () => {
    const r = check({ type: 'env_var', name: 'X_Y' }, makeIndex({ env: [] }));
    isUnknownStatement(r);
    expect(r.reason).toBe('coverage_none');
  });
});

describe('cli rules (7.2)', () => {
  const index = makeIndex({
    cli: [
      { ...loc('package.json', 6), program: 'payments', subcommands: [], flags: ['--verbose'], kind: 'bin' },
      { ...loc('src/cli.ts', 14), program: 'payments', subcommands: ['refund'], flags: ['--confirm', '--reason'], kind: 'command' },
      { ...loc('package.json', 10), program: 'npm', subcommands: ['run', 'db:migrate'], flags: [], kind: 'script' },
      { ...loc('package.json', 11), program: 'npm', subcommands: ['run', 'build'], flags: [], kind: 'script' },
      { ...loc('Makefile', 3), program: 'seed', subcommands: [], flags: [], kind: 'make_target' },
    ],
  });
  const cli = (program: string, subcommands: string[], flags: string[] = []): NormalizedClaim => ({ type: 'cli', program, subcommands, flags });

  it('verified: flags recorded on the command entry count for the bin of the same program', () => {
    const both = makeIndex({
      cli: [
        { ...loc('package.json', 4), program: 'http-server', subcommands: [], flags: [], kind: 'bin' },
        { ...loc('bin/http-server', 40), program: 'http-server', subcommands: [], flags: ['--port', '-p', '--dir-overrides-404'], kind: 'command' },
      ],
    });
    expect(check(cli('http-server', [], ['--port']), both)).toMatchObject({ verdict: 'verified', reason: 'cli_defined', evidence: [{ file: 'bin/http-server', line: 40 }] });
    const missing = check(cli('http-server', [], ['-dir-overrides-404']), both);
    expect(missing).toMatchObject({ verdict: 'contradicted', reason: 'cli_flag_not_defined' });
    expect(missing.statement).toContain('bin/http-server:40');
  });
  it('verified: subcommand and flags defined (global flags allowed)', () => {
    const r = check(cli('payments', ['refund'], ['--confirm', '--verbose', '--help']), index);
    expect(r).toMatchObject({ verdict: 'verified', reason: 'cli_defined' });
    expect(r.evidence[0]).toMatchObject({ file: 'src/cli.ts', line: 14 });
  });
  it('contradicted: flag not defined, cites the subcommand and its flags', () => {
    const r = check(cli('payments', ['refund', '<paymentId>'], ['--force']), index);
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'cli_flag_not_defined' });
    expect(r.statement).toBe('Contradicted by code: payments refund does not define --force. It defines --confirm, --reason at src/cli.ts:14.');
    expect(r.evidence[0]).toMatchObject({ file: 'src/cli.ts', line: 14 });
  });
  it('does not contradict Node options passed through by a wrapper', () => {
    const wrapper = makeIndex({
      cli: [
        {
          ...loc('lib/cli/parse.js', 12),
          program: 'nodemon',
          subcommands: [],
          flags: ['--dump', '--legacy-watch'],
          kind: 'command',
          passesUnknownFlags: true,
        },
      ],
    });
    expect(check(cli('nodemon', [], ['--inspect']), wrapper)).toMatchObject({
      verdict: 'unknown',
      reason: 'dynamic_definition',
    });
    expect(check(cli('nodemon', [], ['--require']), wrapper)).toMatchObject({
      verdict: 'unknown',
      reason: 'dynamic_definition',
    });
    expect(check(cli('nodemon', [], ['--not-a-node-option']), wrapper)).toMatchObject({
      verdict: 'contradicted',
      reason: 'cli_flag_not_defined',
    });
    const mixed = check(cli('nodemon', [], ['--inspect', '--not-a-node-option']), wrapper);
    expect(mixed).toMatchObject({
      verdict: 'contradicted',
      reason: 'cli_flag_not_defined',
      suggestion: { replacement: 'nodemon --inspect' },
    });
    expect(check(cli('nodemon', [], ['--not-a-node-option', '--inspect']), wrapper)).toMatchObject({
      verdict: 'contradicted',
      reason: 'cli_flag_not_defined',
    });
  });
  it('contradicted: subcommand not defined', () => {
    const r = check(cli('payments', ['refound']), index);
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'cli_subcommand_not_defined' });
    expect(r.evidence[0]).toMatchObject({ kind: 'nearest', file: 'src/cli.ts' });
  });
  it('unknown: program not in repo', () => {
    const r = check(cli('ledgerctl', ['reconcile'], ['--since']), index);
    isUnknownStatement(r);
    expect(r.reason).toBe('program_not_in_repo');
  });
  it('unknown: flag missing but cli coverage is partial', () => {
    const r = check(cli('payments', ['refund'], ['--force']), makeIndex({ coverage: { cli: 'partial' }, cli: index.cli }));
    isUnknownStatement(r);
  });
  it('contradicted: a statically complete command keeps its flags under partial coverage', () => {
    const cliEntries = index.cli.map((entry) =>
      entry.file === 'src/cli.ts' && entry.subcommands[0] === 'refund' ? { ...entry, flagsComplete: true } : entry,
    );
    const r = check(cli('payments', ['refund'], ['--force']), makeIndex({ coverage: { cli: 'partial' }, cli: cliEntries }));
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'cli_flag_not_defined' });
    expect(r.evidence[0]).toMatchObject({ file: 'src/cli.ts', line: 14 });
  });
  it('unknown: a statically parsed subcommand can inherit a dynamic root flag', () => {
    const cliEntries = [
      { ...loc('app.py', 1), program: 'ops', subcommands: [], flags: ['--verbose'], kind: 'command' as const, flagsComplete: false },
      { ...loc('app.py', 5), program: 'ops', subcommands: ['sync'], flags: ['--limit'], kind: 'command' as const, flagsComplete: true },
    ];
    const idx = makeIndex({ coverage: { cli: 'partial' }, cli: cliEntries });
    expect(check(cli('ops', ['sync'], ['--dynamic']), idx)).toMatchObject({ verdict: 'unknown', reason: 'coverage_partial' });
    expect(check(cli('ops', ['sync'], ['--verbose', '--limit']), idx).verdict).toBe('verified');
  });
  it('unknown: subcommand missing but cli coverage is partial', () => {
    isUnknownStatement(check(cli('payments', ['nope']), makeIndex({ coverage: { cli: 'partial' }, cli: index.cli })));
  });
  it('unknown: extra tokens may be positional when the program has no subcommands', () => {
    const only = makeIndex({ cli: [{ ...loc('package.json', 6), program: 'tool', subcommands: [], flags: [], kind: 'bin' }] });
    const r = check(cli('tool', ['input.txt']), only);
    expect(r.reason).toBe('dynamic_definition');
  });
  it('unknown: only subcommand entries, root not parsed', () => {
    const sub = makeIndex({ cli: [{ ...loc('a.py', 3), program: 'tool', subcommands: ['run'], flags: [], kind: 'command' }] });
    expect(check(cli('tool', []), sub).reason).toBe('dynamic_definition');
  });
  it('verified: npm run script defined', () => {
    expect(check(cli('npm', ['run', 'db:migrate']), index)).toMatchObject({ verdict: 'verified', reason: 'script_defined' });
  });
  it('verified: yarn and pnpm without run, make target', () => {
    expect(check(cli('yarn', ['build']), index).verdict).toBe('verified');
    expect(check(cli('pnpm', ['run', 'build']), index).verdict).toBe('verified');
    expect(check(cli('make', ['seed']), index).verdict).toBe('verified');
  });
  it('contradicted: script not defined, cites defined scripts', () => {
    const r = check(cli('npm', ['run', 'db:migrat']), index);
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'script_not_defined' });
    expect(r.statement).toContain('It defines db:migrate, build at package.json:10.');
    expect(check(cli('make', ['deploy']), index)).toMatchObject({ verdict: 'contradicted', reason: 'script_not_defined' });
  });
  it('unknown: scripts with partial coverage, no manifest, package manager builtins, bare make', () => {
    isUnknownStatement(check(cli('npm', ['run', 'zzz']), makeIndex({ coverage: { cli: 'partial' }, cli: index.cli })));
    expect(check(cli('npm', ['run', 'zzz']), makeIndex()).reason).toBe('manifest_missing');
    expect(check(cli('npm', ['install']), index).reason).toBe('program_not_in_repo');
    expect(check(cli('npm', []), index).reason).toBe('program_not_in_repo');
    expect(check(cli('make', []), index).reason).toBe('program_not_in_repo');
    expect(check(cli('make', ['x']), makeIndex()).reason).toBe('program_not_in_repo');
  });
  it('unknown: npm test without a test script is a package manager default, not a contradiction', () => {
    expect(check(cli('npm', ['test']), index).verdict).toBe('unknown');
  });
});

describe('config_key rules (7.2)', () => {
  const index = makeIndex({
    configFiles: ['config/default.yaml'],
    config: [
      { ...loc('config/default.yaml', 2), keyPath: 'retry.maxAttempts' },
      { ...loc('config/default.yaml', 3), keyPath: 'retry.backoffMs' },
      { ...loc('config/default.yaml', 6), keyPath: 'server.port' },
    ],
  });
  it('verified: key present (file named by basename or path)', () => {
    expect(check({ type: 'config_key', keyPath: 'retry.maxAttempts' }, index)).toMatchObject({ verdict: 'verified', reason: 'config_key_present' });
    expect(check({ type: 'config_key', keyPath: 'server.port', file: 'default.yaml' }, index).verdict).toBe('verified');
    expect(check({ type: 'config_key', keyPath: 'server.port', file: './config/default.yaml' }, index).verdict).toBe('verified');
  });
  it('contradicted: key absent, sibling keys cited', () => {
    const r = check({ type: 'config_key', keyPath: 'retry.maxTries', file: 'config/default.yaml' }, index);
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'config_key_absent' });
    expect(r.evidence[0]).toMatchObject({ kind: 'nearest', line: 2 });
    expect(r.statement).toContain('retry.maxAttempts, retry.backoffMs at config/default.yaml:2');
  });
  it('contradicted without a file named, falls back to similar last segment', () => {
    const r = check({ type: 'config_key', keyPath: 'other.port' }, index);
    expect(r.verdict).toBe('contradicted');
    expect(r.evidence[0]).toMatchObject({ line: 6 });
  });
  it('unknown: file not in repo, no config files, partial coverage', () => {
    expect(check({ type: 'config_key', keyPath: 'a.b', file: 'nope.yaml' }, index).reason).toBe('config_file_not_in_repo');
    const none = check({ type: 'config_key', keyPath: 'a.b' }, makeIndex({ coverage: { config: 'none' } }));
    isUnknownStatement(none);
    expect(none.reason).toBe('no_config_files');
    isUnknownStatement(check({ type: 'config_key', keyPath: 'a.b' }, makeIndex({ coverage: { config: 'partial' }, configFiles: ['c.yaml'] })));
  });
});

describe('file_path rules (7.2)', () => {
  const files = ['src/routes.ts', 'src/old/seed.sh', 'scripts/seed.sh', 'docs/readme.md'].map((path) => ({ path }));
  const index = makeIndex({ files });
  it('verified: path present, directory present', () => {
    const r = check({ type: 'file_path', path: 'src/routes.ts' }, index);
    expect(r).toMatchObject({ verdict: 'verified', reason: 'file_present' });
    expect(r.evidence[0]).toMatchObject({ file: 'src/routes.ts' });
    expect(r.evidence[0]?.line).toBeUndefined();
    expect(check({ type: 'file_path', path: 'src/' }, index).verdict).toBe('verified');
  });
  it('contradicted: absent, same basename elsewhere is cited', () => {
    const r = check({ type: 'file_path', path: 'bin/seed.sh' }, index);
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'file_absent' });
    expect(r.evidence.slice(0, 2).map((e) => e.file)).toEqual(['scripts/seed.sh', 'src/old/seed.sh']);
    expect(r.statement).toContain('A file with the same name exists at scripts/seed.sh, src/old/seed.sh');
  });
  it('contradicted: parent directory listing when nothing moved', () => {
    const r = check({ type: 'file_path', path: 'src/missing.ts' }, index);
    expect(r.evidence[0]).toMatchObject({ kind: 'nearest', file: 'src/old/seed.sh' });
    expect(r.statement).toContain('The nearest directory contains');
  });
  it('contradicted: nothing similar at all', () => {
    const r = check({ type: 'file_path', path: 'zzz/yyy.ts' }, index);
    expect(r.verdict).toBe('contradicted');
    expect(r.statement).toContain('No file with a similar name');
  });
  it('unknown: tree truncated or partial coverage', () => {
    const truncated = check({ type: 'file_path', path: 'x.ts' }, makeIndex({ files, stats: { filesIndexed: 5000, filesSkipped: 10, truncated: true } }));
    isUnknownStatement(truncated);
    expect(truncated.reason).toBe('tree_truncated');
    isUnknownStatement(check({ type: 'file_path', path: 'x.ts' }, makeIndex({ files, coverage: { files: 'partial' } })));
  });
});

describe('package_version rules (7.2)', () => {
  const index = makeIndex({
    packages: [
      { ...loc('package.json', 15), ecosystem: 'npm', name: 'express', range: '^4.19.2', dev: false },
      { ...loc('package.json', 20), ecosystem: 'npm', name: 'vitest', range: '^5.1.0', dev: true },
      { ...loc('package.json', 8), ecosystem: 'runtime', name: 'node', range: '>=20', dev: false },
      { ...loc('requirements.txt', 2), ecosystem: 'pypi', name: 'Flask_Login', range: '>=0.6,<1', dev: false },
      { ...loc('weird/package.json', 2), ecosystem: 'npm', name: 'odd', range: 'workspace:*', dev: false },
    ],
  });
  const pkg = (ecosystem: 'npm' | 'pypi' | 'runtime', name: string, range: string): NormalizedClaim => ({ type: 'package_version', ecosystem, name, range });

  it('verified when ranges intersect', () => {
    const r = check(pkg('npm', 'express', '4.19.x'), index);
    expect(r).toMatchObject({ verdict: 'verified', reason: 'package_range_intersects' });
    expect(r.evidence[0]).toMatchObject({ file: 'package.json', line: 15 });
    expect(check(pkg('runtime', 'node', '20.x'), index).verdict).toBe('verified');
    expect(check(pkg('pypi', 'flask-login', '0.6.x'), index).verdict).toBe('verified');
    expect(check(pkg('npm', 'vitest', '5.x'), index).verdict).toBe('verified');
  });
  it('contradicted when the declared range conflicts', () => {
    const r = check(pkg('npm', 'express', '3.x'), index);
    expect(r).toMatchObject({ verdict: 'contradicted', reason: 'package_range_conflict' });
    expect(r.statement).toBe('Contradicted by code: express@3.x does not match the declared version. The manifest declares express@^4.19.2 at package.json:15.');
    expect(check(pkg('runtime', 'node', '<18'), index).verdict).toBe('contradicted');
  });
  it('contradicts an outdated minimum runtime even when later versions overlap', () => {
    const r = check(pkg('runtime', 'node', '>=19'), index);
    expect(r).toMatchObject({
      verdict: 'contradicted',
      reason: 'runtime_minimum_conflict',
      suggestion: { replacement: 'Node.js >=20' },
    });
    expect(r.evidence[0]).toMatchObject({ file: 'package.json', line: 8 });
    expect(check(pkg('runtime', 'node', '>=20'), index).verdict).toBe('verified');
    expect(check(pkg('runtime', 'node', '>=22'), index).verdict).toBe('verified');
  });
  it('checks the earliest supported alternative, including an exclusive floor', () => {
    const makeRuntimeIndex = (range: string) => makeIndex({
      packages: [{ ...loc('pyproject.toml', 22), ecosystem: 'runtime', name: 'python', range, dev: false }],
    });
    const claim = pkg('runtime', 'python', '>=3.10');
    expect(check(claim, makeRuntimeIndex('>=3.11 || >=3.9,<3.11')).verdict).toBe('verified');
    expect(check(claim, makeRuntimeIndex('>3.10.0 || >=3.12')).reason).toBe('runtime_minimum_conflict');
    expect(check(claim, makeRuntimeIndex('>3.10')).reason).toBe('runtime_minimum_conflict');
    expect(check(pkg('runtime', 'python', '>=3.10.1'), makeRuntimeIndex('>3.10')).verdict).toBe('verified');
  });
  it('does not infer a strict minimum from a prerelease comparator', () => {
    const prerelease = makeIndex({
      packages: [{ ...loc('package.json', 8), ecosystem: 'runtime', name: 'node', range: '>20.0.0-rc.1', dev: false }],
    });
    expect(check(pkg('runtime', 'node', '>=20.0.0'), prerelease).verdict).toBe('verified');
  });
  it('unknown: not a direct dependency, manifest missing, unparseable range, partial coverage', () => {
    expect(check(pkg('npm', 'stripe', '14.x'), index).reason).toBe('package_not_direct_dependency');
    const missing = check(pkg('pypi', 'x', '1'), makeIndex());
    isUnknownStatement(missing);
    expect(missing.reason).toBe('manifest_missing');
    expect(check(pkg('npm', 'odd', '1.x'), index).reason).toBe('dynamic_definition');
    isUnknownStatement(check(pkg('npm', 'express', '3.x'), makeIndex({ coverage: { packages: 'partial' }, packages: index.packages })));
  });
});

describe('results are bounded', () => {
  it('truncates raw page text and strips control characters', () => {
    const raw = `POST /v1/charge\n${'x'.repeat(400)}\u0007`;
    const r = matchClaim(makeClaim({ type: 'http_endpoint', method: 'POST', path: '/v1/charge' }, raw), makeIndex(), {});
    expect(r.claim.raw.length).toBeLessThanOrEqual(160);
    expect(hasControl(r.claim.raw)).toBe(false);
  });
  it('truncates repo snippets in evidence', () => {
    const idx = makeIndex({ routes: [{ ...loc('a.ts', 1, `router.get('/x') // ${'y'.repeat(300)}\n\t\u0000`), method: 'GET', path: '/x', framework: 'express' }] });
    const e = check({ type: 'http_endpoint', method: 'GET', path: '/x' }, idx).evidence[0];
    expect(e?.snippet?.length).toBeLessThanOrEqual(160);
    expect(hasControl(e?.snippet ?? '')).toBe(false);
  });
  it('builds a bitbucket permalink', () => {
    const idx = makeIndex({ repo: { provider: 'bitbucket', fullName: 'ws/app', ref: 'main', sha: 'abc1234', indexedAt: '2026-12-01T00:00:00.000Z' }, routes: [route('GET', '/x', 7)] });
    expect(check({ type: 'http_endpoint', method: 'GET', path: '/x' }, idx).evidence[0]?.permalink).toBe('https://bitbucket.org/ws/app/src/abc1234/src/routes.ts#lines-7');
  });
});
