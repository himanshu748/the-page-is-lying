import { describe, expect, it } from 'vitest';
import { matchClaim } from '../../../src/core/match';
import { makeSuggestion } from '../../../src/core/match/evidence';
import { declaredAs } from '../../../src/core/match/package';
import type { ClaimResult, NormalizedClaim, PackageEntry, RepoIndex } from '../../../src/core/model';
import { makeClaim, makeIndex } from '../../fixtures/match/builders';

const loc = (file: string, line: number) => ({ file, line, snippet: 'x' });
const check = (normalized: NormalizedClaim, index: RepoIndex): ClaimResult => matchClaim(makeClaim(normalized, 'raw text'), index);

describe('fix suggestions on contradicted results', () => {
  it('route: proposes the nearest route and names the evidence it was read from', () => {
    const index = makeIndex({
      routes: [
        { ...loc('src/routes.ts', 88), method: 'POST', path: '/v2/payments', framework: 'express' },
        { ...loc('src/routes.ts', 92), method: 'GET', path: '/v2/payments/:param', framework: 'express' },
      ],
    });
    const r = check({ type: 'http_endpoint', method: 'POST', path: '/v1/payments' }, index);
    expect(r.verdict).toBe('contradicted');
    expect(r.suggestion).toMatchObject({ kind: 'replace', replacement: 'POST /v2/payments', evidenceId: r.evidence[0]?.id });
    expect(r.evidence[0]).toMatchObject({ kind: 'nearest', line: 88 });
  });

  it('route: proposes removal when the code has nothing similar', () => {
    const r = check({ type: 'http_endpoint', method: 'POST', path: '/x' }, makeIndex({ routes: [] }));
    expect(r.suggestion).toEqual({ kind: 'remove' });
  });

  it('env var: proposes the nearest name the code reads', () => {
    const index = makeIndex({
      env: [
        { ...loc('src/config.ts', 4), name: 'STRIPE_SECRET_KEY', source: 'code' },
        { ...loc('src/config.ts', 9), name: 'DATABASE_URL', source: 'code' },
      ],
    });
    const r = check({ type: 'env_var', name: 'STRIPE_KEY' }, index);
    expect(r.suggestion).toMatchObject({ kind: 'replace', replacement: 'STRIPE_SECRET_KEY', evidenceId: r.evidence[0]?.id });
  });

  it('cli flag: proposes the command without the undefined flag and lists the defined flags', () => {
    const index = makeIndex({
      cli: [
        { ...loc('src/cli.ts', 5), program: 'payments', subcommands: [], flags: [], kind: 'bin' },
        { ...loc('src/cli.ts', 12), program: 'payments', subcommands: ['refund'], flags: ['--confirm', '--amount'], kind: 'command' },
      ],
    });
    const r = check({ type: 'cli', program: 'payments', subcommands: ['refund'], flags: ['--force'] }, index);
    expect(r.reason).toBe('cli_flag_not_defined');
    expect(r.suggestion).toEqual({
      kind: 'replace',
      replacement: 'payments refund',
      evidenceId: r.evidence[0]?.id,
      alternatives: ['payments refund --confirm', 'payments refund --amount'],
    });
  });

  it('cli flag: prefers the declared dash spelling and preserves the assigned value', () => {
    const index = makeIndex({
      cli: [
        { ...loc('bin/http-server', 13), program: 'http-server', subcommands: [], flags: ['--port', '--dir-overrides-404'], kind: 'command', flagLines: { '--dir-overrides-404': 203 } },
      ],
    });
    const result = matchClaim(
      makeClaim({ type: 'cli', program: 'http-server', subcommands: [], flags: ['-dir-overrides-404', '--port'] },
        'http-server -dir-overrides-404=false --port 3000'),
      index,
    );
    expect(result.suggestion).toMatchObject({
      kind: 'replace',
      replacement: 'http-server --dir-overrides-404=false --port 3000',
      evidenceId: result.evidence[0]?.id,
    });
    expect(result.evidence[0]).toMatchObject({ file: 'bin/http-server', line: 203 });
  });

  it('cli: the proposed command keeps the arguments and flag values the page wrote', () => {
    const index = makeIndex({
      cli: [
        { ...loc('src/cli.ts', 5), program: 'payments', subcommands: [], flags: [], kind: 'bin' },
        { ...loc('src/cli.ts', 12), program: 'payments', subcommands: ['refund'], flags: ['--confirm', '--amount'], kind: 'command' },
      ],
    });
    const flag = matchClaim(
      makeClaim({ type: 'cli', program: 'payments', subcommands: ['refund', '<paymentId>'], flags: ['--amount', '--force'] }, 'payments refund <paymentId> --amount 500 --force'),
      index,
    );
    expect(flag.reason).toBe('cli_flag_not_defined');
    expect(flag.suggestion).toMatchObject({
      replacement: 'payments refund <paymentId> --amount 500',
      alternatives: ['payments refund <paymentId> --amount 500 --confirm'],
    });
    // Every flag the code does not define is removed, so the proposed command is not itself contradicted.
    const several = matchClaim(makeClaim({ type: 'cli', program: 'payments', subcommands: ['refund'], flags: ['--force', '--old', '--amount'] }, 'payments refund --force --old=1 --amount 5'), index);
    expect(several.suggestion).toMatchObject({ replacement: 'payments refund --amount 5', alternatives: ['payments refund --confirm --amount 5'] });
    const fixed = matchClaim(makeClaim({ type: 'cli', program: 'payments', subcommands: ['refund'], flags: ['--amount'] }, several.suggestion?.replacement ?? ''), index);
    expect(fixed.verdict).toBe('verified');
    const valued = matchClaim(makeClaim({ type: 'cli', program: 'payments', subcommands: ['refund', '<id>'], flags: ['--force'] }, 'payments refund <id> --force=true'), index);
    expect(valued.suggestion?.replacement).toBe('payments refund <id>');
    const sub = matchClaim(makeClaim({ type: 'cli', program: 'payments', subcommands: ['refnd', '<paymentId>'], flags: ['--confirm'] }, 'payments refnd <paymentId> --confirm'), index);
    expect(sub.reason).toBe('cli_subcommand_not_defined');
    expect(sub.suggestion?.replacement).toBe('payments refund <paymentId> --confirm');
    const sameName = makeIndex({
      cli: [
        { ...loc('src/cli.ts', 5), program: 'deploy', subcommands: [], flags: [], kind: 'bin' },
        { ...loc('src/cli.ts', 9), program: 'deploy', subcommands: ['release'], flags: [], kind: 'command' },
      ],
    });
    const repeated = matchClaim(makeClaim({ type: 'cli', program: 'deploy', subcommands: ['deploy'], flags: [] }, 'deploy deploy'), sameName);
    expect(repeated.suggestion?.replacement).toBe('deploy release');
  });

  it('cli subcommand and npm script: propose the defined name in the same command line', () => {
    const index = makeIndex({
      cli: [
        { ...loc('src/cli.ts', 5), program: 'payments', subcommands: [], flags: [], kind: 'bin' },
        { ...loc('src/cli.ts', 12), program: 'payments', subcommands: ['refund'], flags: [], kind: 'command' },
        { ...loc('package.json', 7), program: 'npm', subcommands: ['db:migrate'], flags: [], kind: 'script' },
      ],
    });
    expect(check({ type: 'cli', program: 'payments', subcommands: ['refnd'], flags: [] }, index).suggestion).toMatchObject({ kind: 'replace', replacement: 'payments refund' });
    const script = check({ type: 'cli', program: 'npm', subcommands: ['run', 'migrate'], flags: [] }, index);
    expect(script.reason).toBe('script_not_defined');
    expect(script.suggestion).toMatchObject({ kind: 'replace', replacement: 'npm run db:migrate' });
  });

  it('package version: the proposed text uses the notation of its ecosystem', () => {
    const entry = (ecosystem: PackageEntry['ecosystem'], name: string, range: string): PackageEntry => ({ ...loc('manifest', 3), ecosystem, name, range, dev: false });
    expect(declaredAs(entry('npm', 'express', '^5.1.0'))).toBe('express@^5.1.0');
    expect(declaredAs(entry('go', 'github.com/gin-gonic/gin', 'v1.9.1'))).toBe('github.com/gin-gonic/gin@v1.9.1');
    expect(declaredAs(entry('pypi', 'requests', '>=2.31,<3'))).toBe('requests>=2.31,<3');
    expect(declaredAs(entry('pypi', 'requests', '2.31.0'))).toBe('requests==2.31.0');
    expect(declaredAs(entry('maven', 'org.slf4j:slf4j-api', '2.0.9'))).toBe('org.slf4j:slf4j-api:2.0.9');
    expect(declaredAs(entry('runtime', 'node', '>=20'))).toBe('Node.js >=20');
    expect(declaredAs(entry('runtime', 'python', '>=3.11'))).toBe('Python >=3.11');
    expect(declaredAs(entry('pypi', 'requests', '*'))).toBeUndefined();
    const pip = check({ type: 'package_version', ecosystem: 'pypi', name: 'requests', range: '==1.2.0' }, makeIndex({ packages: [entry('pypi', 'requests', '==2.31.0')] }));
    expect(pip.verdict).toBe('contradicted');
    expect(pip.suggestion).toMatchObject({ kind: 'replace', replacement: 'requests==2.31.0' });
  });

  it('config key, package version and moved file', () => {
    const config = check(
      { type: 'config_key', keyPath: 'retry.maxAttempts' },
      makeIndex({ config: [{ ...loc('config/default.yaml', 3), keyPath: 'retry.attempts' }], configFiles: ['config/default.yaml'] }),
    );
    expect(config.suggestion).toMatchObject({ kind: 'replace', replacement: 'retry.attempts' });

    const pkg = check(
      { type: 'package_version', ecosystem: 'npm', name: 'express', range: '4.x' },
      makeIndex({ packages: [{ ...loc('package.json', 12), ecosystem: 'npm', name: 'express', range: '^5.1.0', dev: false }] }),
    );
    expect(pkg.suggestion).toMatchObject({ kind: 'replace', replacement: 'express@^5.1.0', evidenceId: pkg.evidence[0]?.id });

    const files = makeIndex({ files: [{ path: 'scripts/db/migrate.sh' }, { path: 'docs/readme.md' }] });
    expect(check({ type: 'file_path', path: 'scripts/migrate.sh' }, files).suggestion).toMatchObject({ kind: 'replace', replacement: 'scripts/db/migrate.sh' });
    // Neighbours in the nearest directory are not a counterpart of the missing file.
    expect(check({ type: 'file_path', path: 'docs/runbook.md' }, files).suggestion).toEqual({ kind: 'remove' });
  });

  it('never appears on verified or no-evidence results', () => {
    const index = makeIndex({ routes: [{ ...loc('src/routes.ts', 88), method: 'POST', path: '/v2/payments', framework: 'express' }], coverage: { env: 'partial' } });
    expect(check({ type: 'http_endpoint', method: 'POST', path: '/v2/payments' }, index).suggestion).toBeUndefined();
    expect(check({ type: 'env_var', name: 'STRIPE_KEY' }, index).suggestion).toBeUndefined();
  });

  it('strips control characters from repository text and caps the alternatives', () => {
    const s = makeSuggestion(['A\nB', 'c1', 'c2', 'c2', 'c3', 'c4', 'A B']);
    expect(s).toEqual({ kind: 'replace', replacement: 'A B', alternatives: ['c1', 'c2', 'c3'] });
    expect(makeSuggestion(['', '\n'])).toEqual({ kind: 'remove' });
  });

  it('quotes a replacement in full or not at all', () => {
    const long = `src/${'a'.repeat(200)}/handler.ts`;
    expect(makeSuggestion([long])?.replacement).toBe(long);
    const tooLong = `src/${'a'.repeat(400)}/handler.ts`;
    expect(makeSuggestion([tooLong, 'src/short.ts'])).toBeUndefined();
    expect(makeSuggestion(['src/short.ts', tooLong])).toEqual({ kind: 'replace', replacement: 'src/short.ts' });
  });
});
