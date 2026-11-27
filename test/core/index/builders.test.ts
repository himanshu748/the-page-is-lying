import { describe, expect, it } from 'vitest';
import { buildRepoIndex } from '../../../src/core/index/build';
import { extractClaimsFromText } from '../../../src/core/claims';
import { matchClaim } from '../../../src/core/match';
import type { RepoIndex } from '../../../src/core/model';
import { loadFixture } from '../../repo/helpers';

function index(name: string, extra: { truncated?: boolean } = {}): RepoIndex {
  const files = loadFixture(name);
  return buildRepoIndex(files, {
    repo: { provider: 'github', fullName: 'o/r', ref: 'main', sha: 'a'.repeat(40), indexedAt: '2026-11-15T00:00:00.000Z' },
    stats: { filesIndexed: files.length, filesSkipped: 0, truncated: extra.truncated ?? false },
  });
}

const route = (i: RepoIndex, method: string, path: string) => i.routes.filter((r) => r.method === method && r.path === path);

it.each([
  { fallback: '*', pattern: '/*' },
  { fallback: '/*splat', pattern: '/*splat' },
  { fallback: '/{*splat}', pattern: '/{*splat}' },
])('does not verify removed API endpoints through a $fallback frontend fallback', ({ fallback, pattern }) => {
  const source = [
    "import express from 'express';",
    'const app = express();',
    "app.get('/v2/refunds/:id', readRefund);",
    `app.get('${fallback}', serveFrontend);`,
  ].join('\n');
  const repoIndex = buildRepoIndex([{ path: 'src/server.ts', text: source }], {
    repo: { provider: 'github', fullName: 'o/r', ref: 'main', sha: 'a'.repeat(40), indexedAt: '2026-11-15T00:00:00.000Z' },
    stats: { filesIndexed: 1, filesSkipped: 0, truncated: false },
  });
  const page = [
    '`GET /v1/refunds/123`',
    '`GET /v2/refunds/123`',
    `\`GET ${pattern}\``,
    '`POST /v1/refunds/123`',
  ].join('\n\n');
  const results = extractClaimsFromText(page).claims.map((claim) => matchClaim(claim, repoIndex));
  expect(results).toMatchObject([
    { verdict: 'unknown', reason: 'route_wildcard_only', evidence: [{ file: 'src/server.ts', line: 4 }] },
    { verdict: 'verified', reason: 'route_exact', evidence: [{ file: 'src/server.ts', line: 3 }] },
    { verdict: 'verified', reason: 'route_exact', evidence: [{ file: 'src/server.ts', line: 4 }] },
    { verdict: 'contradicted', evidence: [{ file: 'src/server.ts', line: 3 }, { kind: 'absence' }] },
  ]);
  expect(results[0]?.suggestion).toBeUndefined();
  expect(results[3]?.suggestion?.alternatives).toBeUndefined();
});

it('checks literal defaults in a Markdown option table independently of flag names', () => {
  const source = [
    "import { Command } from 'commander';",
    "const program = new Command('my-cli');",
    "program.option('-p, --port <number>', 'Listen port', 3000);",
    "program.option('--address <host>', 'Listen address', '::');",
    "program.option('--output <path>', 'Output path', process.env.OUTPUT_PATH);",
    "program.command('serve-all').option('--port <number>', 'Listen port', 4000.0);",
  ].join('\n');
  const repoIndex = buildRepoIndex([{ path: 'src/cli.ts', text: source }], {
    repo: { provider: 'github', fullName: 'o/r', ref: 'main', sha: 'a'.repeat(40), indexedAt: '2026-11-15T00:00:00.000Z' },
    stats: { filesIndexed: 1, filesSkipped: 0, truncated: false },
  });
  const page = [
    'my-cli [options]',
    '',
    '| Option | Description | Default |',
    '| --- | --- | --- |',
    '| `-p` or `--port` | Listener port | `3000` |',
    '| `--address` | 0.0.0.0 for all IPv4 addresses | `0.0.0.0` |',
    '| `--output` | Output | `log` |',
    '| `--format` | Format | See configuration |',
  ].join('\n');
  const { claims } = extractClaimsFromText(page);
  const defaults = claims.filter(({ normalized }) => normalized.type === 'cli' && normalized.defaultValue !== undefined);
  expect(defaults.map(({ raw, location }) => [raw, page.slice(location.start, location.end)])).toEqual([
    ['3000', '3000'], ['0.0.0.0', '0.0.0.0'], ['log', 'log'],
  ]);
  expect(defaults[1]?.location.start).toBe(page.indexOf('`0.0.0.0`') + 1);
  expect(defaults.map((claim) => matchClaim(claim, repoIndex))).toMatchObject([
    { verdict: 'verified', reason: 'cli_default_matches', evidence: [{ line: 3 }] },
    { verdict: 'contradicted', reason: 'cli_default_mismatch', evidence: [{ line: 4 }] },
    { verdict: 'unknown', reason: 'cli_default_unresolved' },
  ]);
  const format = claims.find((claim) => claim.raw === '--format');
  expect(format && matchClaim(format, repoIndex).reason).toBe('cli_flag_not_defined');

  const subcommandPage = [
    'Usage: my-cli serve-all [options]',
    '',
    '| Option | Default |',
    '| --- | --- |',
    '| `--port` | `4000` |',
  ].join('\n');
  const subcommandDefault = extractClaimsFromText(subcommandPage).claims.find(({ raw }) => raw === '4000');
  expect(subcommandDefault?.normalized).toMatchObject({ subcommands: ['serve-all'] });
  expect(subcommandDefault && matchClaim(subcommandDefault, repoIndex)).toMatchObject({
    verdict: 'verified', reason: 'cli_default_matches', evidence: [{ line: 6 }],
  });
});

describe('payments-api-mini (demo contract)', () => {
  const i = index('payments-api-mini');

  it('indexes POST /v2/payments at src/routes.ts:88 and resolves the root mount', () => {
    const hit = route(i, 'POST', '/v2/payments');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ file: 'src/routes.ts', line: 88, framework: 'express' });
    expect(hit[0]?.snippet).toBe("router.post('/v2/payments', createPayment);");
    expect(route(i, 'GET', '/v2/payments/:param')[0]?.line).toBe(89);
    expect(route(i, 'POST', '/v1/charge')).toHaveLength(0);
  });

  it('reads env in code and .env.example with lines', () => {
    const key = i.env.filter((e) => e.name === 'PAYMENTS_API_KEY');
    expect(key.map((e) => [e.file, e.line, e.source]).sort()).toEqual([
      ['.env.example', 1, 'env_example'],
      ['src/config.ts', 2, 'code'],
    ]);
    expect(i.env.some((e) => e.name === 'DATABASE_URL' && e.file === 'src/config.ts')).toBe(true);
    expect(i.env.some((e) => e.name === 'PORT' && e.file === 'src/config.ts')).toBe(true);
    expect(i.env.some((e) => e.name === 'STRIPE_KEY')).toBe(false);
    expect(i.coverage.env).toBe('complete');
  });

  it('indexes commander commands with their flags and never --force', () => {
    const refund = i.cli.find((c) => c.kind === 'command' && c.subcommands.join(' ') === 'refund');
    expect(refund).toMatchObject({ program: 'payments', file: 'src/cli.ts', line: 7 });
    expect(refund?.flags).toEqual(expect.arrayContaining(['--confirm', '--reason', '-r', '--help']));
    expect(refund?.flags).not.toContain('--force');
    const root = i.cli.find((c) => c.kind === 'command' && c.subcommands.length === 0);
    expect(root?.program).toBe('payments');
    expect(root?.flags).toEqual(expect.arrayContaining(['--version', '-V']));
    expect(i.cli.find((c) => c.kind === 'bin')).toMatchObject({ program: 'payments', file: 'package.json' });
  });

  it('indexes package scripts and dependencies', () => {
    const script = i.cli.find((c) => c.kind === 'script' && c.subcommands[1] === 'db:migrate');
    expect(script).toMatchObject({ program: 'npm', subcommands: ['run', 'db:migrate'], file: 'package.json', line: 8 });
    expect(i.cli.some((c) => c.kind === 'script' && c.subcommands.join(' ') === 'start')).toBe(true);
    const ex = i.packages.find((p) => p.name === 'express');
    expect(ex).toMatchObject({ ecosystem: 'npm', range: '^4.18.2', dev: false, file: 'package.json', line: 12 });
    expect(i.packages.find((p) => p.name === 'typescript')?.dev).toBe(true);
    expect(i.packages.find((p) => p.ecosystem === 'runtime' && p.name === 'node')?.range).toBe('>=20');
  });

  it('indexes yaml config keys with line numbers', () => {
    expect(i.config.find((c) => c.keyPath === 'retry.maxAttempts')).toMatchObject({ file: 'config/default.yaml', line: 4 });
    expect(i.config.find((c) => c.keyPath === 'server.port')?.line).toBe(2);
    expect(i.configFiles).toEqual(['config/default.yaml']);
  });

  it('lists the file tree', () => {
    expect(i.files.map((f) => f.path)).toEqual(expect.arrayContaining(['src/routes.ts', 'CHANGELOG.md', '.env.example']));
  });

  it('reports complete coverage for the demo shape', () => {
    expect(i.coverage).toEqual({ routes: 'complete', env: 'complete', cli: 'complete', config: 'complete', files: 'complete', packages: 'complete' });
  });
});

describe('Express variants', () => {
  const i = index('express-variants');
  it('applies mount prefixes across files', () => {
    expect(route(i, 'GET', '/api/users')[0]).toMatchObject({ file: 'src/routes/users.ts', line: 3 });
    expect(route(i, 'DELETE', '/api/users/:param')[0]).toMatchObject({ file: 'src/routes/users.ts', line: 4 });
    expect(route(i, 'GET', '/api/users/me')).toHaveLength(1);
    expect(route(i, 'GET', '/api/users/profile')).toHaveLength(1);
    expect(route(i, 'POST', '/admin/reindex')).toHaveLength(1);
  });
  it('handles app.route chains and plain routes', () => {
    expect(route(i, 'GET', '/books')[0]?.line).toBe(14);
    expect(route(i, 'POST', '/books')[0]?.line).toBe(15);
    expect(route(i, 'GET', '/ping')).toHaveLength(1);
  });
  it('ignores client calls, settings getters, comments and strings', () => {
    const paths = i.routes.map((r) => r.path);
    expect(paths).not.toContain('/not-a-route');
    expect(paths).not.toContain('/commented-out');
    expect(paths).not.toContain('/in-a-string');
    expect(paths).not.toContain('/env');
  });
  it('drops routes of a router that is never mounted and flags partial', () => {
    expect(i.routes.map((r) => r.path)).not.toContain('/never-mounted');
    expect(i.coverage.routes).toBe('partial');
  });
});

describe('dynamic registration', () => {
  const i = index('express-dynamic');
  it('marks routes and env partial', () => {
    expect(route(i, 'GET', '/static')).toHaveLength(1);
    expect(i.coverage.routes).toBe('partial');
    expect(i.coverage.env).toBe('partial');
  });
});

describe('Fastify, Hono, Koa', () => {
  it('Fastify: prefix via register, route(), plugin param', () => {
    const i = index('fastify-app');
    expect(route(i, 'GET', '/health')).toHaveLength(1);
    expect(route(i, 'GET', '/items/:param')[0]).toMatchObject({ file: 'src/items.ts', line: 3, framework: 'fastify' });
    expect(route(i, 'PUT', '/items/:param')).toHaveLength(1);
    expect(route(i, 'POST', '/webhook')).toHaveLength(1);
    expect(i.coverage.routes).toBe('complete');
  });
  it('Fastify: full declarations use effective top-level route options', () => {
    const fixture = index('fastify-app');
    const i = buildRepoIndex([{ path: 'src/server.ts', text: [
      "import Fastify from 'fastify';",
      'const app = Fastify();',
      "app.route({ method: 'GET', url: '/overridden', ...runtimeOptions });",
      "app.route({ method: ['GET', process.env.METHOD], url: '/runtime-method' });",
      "app.route({ config: { method: 'GET', url: '/nested' }, method: 'POST', path: '/alias' });",
      "app.route({ ...runtimeOptions, 'method': ['PUT', 'DELETE',], 'url': '/stable', handler });",
      "app.route({ method: 'GET', path: '/shadowed', url: '/preferred', handler });",
      "app.route({ method: 'GET', url: '/getter-shadowed', get url() { return process.env.REPORT_PATH; } });",
      "app.route({ method: ['GET', 'CUSTOM'], url: '/unsupported-method' });",
    ].join('\n') }], { repo: fixture.repo, stats: { filesIndexed: 1, filesSkipped: 0, truncated: false } });
    expect(i.coverage.routes).toBe('partial');
    expect(i.routes.map(({ method, path }) => [method, path])).toEqual([
      ['POST', '/alias'], ['PUT', '/stable'], ['DELETE', '/stable'], ['GET', '/preferred'],
    ]);
    const { claims } = extractClaimsFromText('`GET /overridden`\n\n`GET /runtime-method`\n\n`GET /nested`\n\n`GET /getter-shadowed`\n\n`GET /unsupported-method`\n\n`PUT /stable`');
    expect(claims.map((claim) => matchClaim(claim, i))).toMatchObject([
      { verdict: 'unknown', reason: 'coverage_partial' },
      { verdict: 'unknown', reason: 'coverage_partial' },
      { verdict: 'unknown', reason: 'coverage_partial' },
      { verdict: 'unknown', reason: 'coverage_partial' },
      { verdict: 'unknown', reason: 'coverage_partial' },
      { verdict: 'verified', reason: 'route_exact', evidence: [{ file: 'src/server.ts', line: 6 }] },
    ]);
  });
  it.each([
    '{ prefix: process.env.API_PREFIX }',
    '{ prefix: `/${version}` }',
    '{ prefix }',
    'pluginOptions',
    '{ prefix: "/overridden", ...pluginOptions }',
  ])('Fastify: unresolved plugin options %s cannot confirm an unprefixed route', (options) => {
    const fixture = index('fastify-app');
    const i = buildRepoIndex([
      { path: 'src/server.ts', text: [
        "import Fastify from 'fastify';",
        "import catalog from './catalog';",
        "import status from './status';",
        'const app = Fastify();',
        `app.register(catalog, ${options});`,
        "app.register(status, { ...pluginOptions, prefix: '/stable' });",
        "app.get('/health', handler);",
      ].join('\n') },
      { path: 'src/catalog.ts', text: [
        "import type { FastifyInstance } from 'fastify';",
        'export default function catalog(instance: FastifyInstance) {',
        "  instance.get('/books', handler);",
        '}',
      ].join('\n') },
      { path: 'src/status.ts', text: [
        "import type { FastifyInstance } from 'fastify';",
        'export default function status(instance: FastifyInstance) {',
        "  instance.get('/status', handler);",
        '}',
      ].join('\n') },
    ], { repo: fixture.repo, stats: { filesIndexed: 3, filesSkipped: 0, truncated: false } });
    expect(i.coverage.routes).toBe('partial');
    expect(i.routes.map((r) => r.path)).toEqual(['/health', '/stable/status']);
    const { claims } = extractClaimsFromText('`GET /books`\n\n`GET /stable/status`');
    expect(claims.map((claim) => matchClaim(claim, i))).toMatchObject([
      { verdict: 'unknown', reason: 'coverage_partial' },
      { verdict: 'verified', reason: 'route_exact', evidence: [{ file: 'src/status.ts', line: 3 }] },
    ]);
  });
  it('Hono: basePath and route()', () => {
    const i = index('hono-app');
    expect(route(i, 'GET', '/api/hello')).toHaveLength(1);
    expect(route(i, 'GET', '/api/books')[0]).toMatchObject({ file: 'src/books.ts', line: 3 });
    expect(route(i, 'POST', '/api/books')).toHaveLength(1);
  });
  it('Hono: a dynamic base path never confirms an unprefixed route', () => {
    const fixture = index('hono-app');
    const i = buildRepoIndex([{ path: 'src/app.ts', text: [
      "import { Hono } from 'hono';",
      'const app = new Hono().basePath(process.env.API_PREFIX);',
      'const child = new Hono();',
      "app.get('/status', handler);",
      "child.get('/books', handler);",
      "app.route('/catalog', child);",
      'const health = new Hono();',
      "health.get('/health', handler);",
    ].join('\n') }], { repo: fixture.repo, stats: { filesIndexed: 1, filesSkipped: 0, truncated: false } });
    expect(i.coverage.routes).toBe('partial');
    expect(i.routes.map((r) => r.path)).toEqual(['/health']);
  });
  it('Hono: a dynamic route mount does not expose the child at its unprefixed path', () => {
    const fixture = index('hono-app');
    const i = buildRepoIndex([{ path: 'src/app.ts', text: [
      "import { Hono } from 'hono';",
      'const app = new Hono();',
      'const child = new Hono();',
      'const both = new Hono();',
      "child.get('/books', handler);",
      "both.get('/status', handler);",
      "app.get('/health', handler);",
      'app.route(process.env.API_PREFIX, child);',
      'app.route(process.env.ADMIN_PREFIX, both);',
      "app.route('/public', both);",
    ].join('\n') }], { repo: fixture.repo, stats: { filesIndexed: 1, filesSkipped: 0, truncated: false } });
    expect(i.coverage.routes).toBe('partial');
    expect(i.routes.map((r) => r.path)).toEqual(['/public/status', '/health']);
    const { claims } = extractClaimsFromText('`GET /books`\n\n`GET /public/status`');
    expect(claims.map((claim) => matchClaim(claim, i))).toMatchObject([
      { verdict: 'unknown', reason: 'coverage_partial' },
      { verdict: 'verified', reason: 'route_exact', evidence: [{ file: 'src/app.ts', line: 6 }] },
    ]);
  });
  it('Koa router: constructor prefix and routes()', () => {
    const i = index('koa-app');
    expect(route(i, 'GET', '/v1/status')[0]?.line).toBe(5);
    expect(route(i, 'POST', '/v1/jobs')).toHaveLength(1);
  });
  it.each(["'/api'", 'process.env.API_PREFIX'])(
    'Koa: a router prefix changed by %s cannot confirm the original route',
    (prefix) => {
      const fixture = index('koa-app');
      const i = buildRepoIndex([{ path: 'src/server.ts', text: [
        "import Koa from 'koa';",
        "import Router from '@koa/router';",
        'const app = new Koa();',
        'const catalog = new Router();',
        "const health = new Router({ prefix: '/stable' });",
        "catalog.get('/books', handler);",
        `catalog.prefix(${prefix});`,
        "health.get('/status', handler);",
        'app.use(catalog.routes());',
        'app.use(health.routes());',
      ].join('\n') }], { repo: fixture.repo, stats: { filesIndexed: 1, filesSkipped: 0, truncated: false } });
      const { claims } = extractClaimsFromText('`GET /books`\n\n`GET /stable/status`');
      expect(claims.map((claim) => matchClaim(claim, i))).toMatchObject([
        { verdict: 'unknown', reason: 'coverage_partial' },
        { verdict: 'verified', reason: 'route_exact' },
      ]);
    },
  );
  it.each([
    '{ prefix: process.env.API_PREFIX }',
    '{ prefix: `/v${version}` }',
    '{ prefix }',
    'routerOptions',
    '{ prefix: "/overridden", ...routerOptions }',
  ])('Koa: unresolved router options %s cannot confirm an unprefixed route', (options) => {
    const fixture = index('koa-app');
    const i = buildRepoIndex([{ path: 'src/server.ts', text: [
      "import Koa from 'koa';",
      "import Router from '@koa/router';",
      'const app = new Koa();',
      `const catalog = new Router(${options});`,
      "const status = new Router({ ...routerOptions, prefix: '/stable' });",
      "catalog.get('/books', handler);",
      "status.get('/status', handler);",
      'app.use(catalog.routes());',
      'app.use(status.routes());',
    ].join('\n') }], { repo: fixture.repo, stats: { filesIndexed: 1, filesSkipped: 0, truncated: false } });
    expect(i.coverage.routes).toBe('partial');
    expect(i.routes.map((r) => r.path)).toEqual(['/stable/status']);
    const { claims } = extractClaimsFromText('`GET /books`\n\n`GET /stable/status`');
    expect(claims.map((claim) => matchClaim(claim, i))).toMatchObject([
      { verdict: 'unknown', reason: 'coverage_partial' },
      { verdict: 'verified', reason: 'route_exact', evidence: [{ file: 'src/server.ts', line: 7 }] },
    ]);
  });
});

describe('yargs', () => {
  const i = index('yargs-app');
  it('assigns options to commands and root', () => {
    const sync = i.cli.find((c) => c.subcommands[0] === 'sync');
    expect(sync?.program).toBe('ledger');
    expect(sync?.flags).toEqual(expect.arrayContaining(['--full', '-f', '--since']));
    expect(sync?.flags).not.toContain('--verbose');
    const purge = i.cli.find((c) => c.subcommands[0] === 'purge');
    expect(purge?.flags).toContain('--force');
    const root = i.cli.find((c) => c.kind === 'command' && c.subcommands.length === 0);
    expect(root?.flags).toEqual(expect.arrayContaining(['--verbose', '-v', '--version']));
  });
});

describe('Python', () => {
  const i = index('python-app');
  it('FastAPI with include_router prefixes', () => {
    expect(route(i, 'GET', '/health')[0]).toMatchObject({ file: 'app/main.py', line: 13, framework: 'fastapi' });
    expect(route(i, 'GET', '/v1/items/:param')[0]).toMatchObject({ file: 'app/routers/items.py', line: 6 });
    expect(route(i, 'POST', '/v1/items')).toHaveLength(1);
    expect(i.routes.map((r) => r.path)).not.toContain('/in-docstring');
  });
  it.each(['prefix=settings.API_PREFIX', '**router_options'])('FastAPI leaves constructor prefix from %s unresolved', (options) => {
    const result = buildRepoIndex([{ path: 'app.py', text: [
      'from fastapi import APIRouter, FastAPI',
      'app = FastAPI()',
      `catalog = APIRouter(${options})`,
      'health = APIRouter(prefix="/v1")',
      '@catalog.get("/books")',
      'def books(): pass',
      '@health.get("/status")',
      'def status(): pass',
      'app.include_router(catalog, prefix="/catalog")',
      'app.include_router(health, prefix="/stable")',
    ].join('\n') }], { repo: i.repo, stats: { filesIndexed: 1, filesSkipped: 0, truncated: false } });
    expect(result.coverage.routes).toBe('partial');
    const { claims } = extractClaimsFromText('`GET /catalog/books`\n\n`GET /stable/v1/status`');
    expect(claims.map((claim) => matchClaim(claim, result))).toMatchObject([
      { verdict: 'unknown', reason: 'coverage_partial' },
      { verdict: 'verified', reason: 'route_exact' },
    ]);
  });
  it.each([
    { options: "url_prefix='/default'", registration: ", url_prefix='/live'", path: '/live/health', partial: false },
    { options: "url_prefix='/default'", registration: ", url_prefix=''", path: '/health', partial: false },
    { options: "url_prefix='/default'", registration: ', url_prefix=None', path: '/default/health', partial: false },
    { options: 'url_prefix=settings.API_PREFIX', registration: '', path: null, partial: true },
    { options: '**blueprint_options', registration: ", url_prefix='/live'", path: '/live/health', partial: true },
    { options: "url_prefix='/default'", registration: ', **mount_options', path: null, partial: true },
    { options: "None, None, None, '/positional'", registration: '', path: '/positional/health', partial: false },
  ])('Flask builds only the resolved route for $options with $registration', ({ options, registration, path, partial }) => {
    const source = [
      'from flask import Flask, Blueprint',
      'app = Flask(__name__)',
      `bp = Blueprint('health', __name__, ${options})`,
      '@bp.get("/health")',
      'def read_health(): pass',
      `app.register_blueprint(bp${registration})`,
    ].join('\n');
    const index = buildRepoIndex([{ path: 'app.py', text: source }], {
      repo: { provider: 'github', fullName: 'o/r', ref: 'main', sha: 'a'.repeat(40), indexedAt: '2026-11-15T00:00:00.000Z' },
      stats: { filesIndexed: 1, filesSkipped: 0, truncated: false },
    });
    expect(index.routes.map((entry) => entry.path)).toEqual(path ? [path] : []);
    if (partial) expect(index.coverage.routes).toBe('partial');
  });

  it('Flask routes, methods and blueprint prefix', () => {
    expect(route(i, 'GET', '/')[0]).toMatchObject({ file: 'flask_app.py', line: 7 });
    expect(route(i, 'GET', '/admin/users/:param')).toHaveLength(1);
    expect(route(i, 'DELETE', '/admin/users/:param')).toHaveLength(1);
  });
  it('os.environ, os.getenv and pydantic settings (partial)', () => {
    for (const n of ['DATABASE_URL', 'API_KEY', 'APP_MODE']) expect(i.env.some((e) => e.name === n && e.file === 'app/main.py')).toBe(true);
    expect(i.coverage.env).toBe('partial');
  });
  it('argparse and click', () => {
    const pytoolRoot = i.cli.find((c) => c.file === 'tool.py' && c.subcommands.length === 0 && c.kind === 'command' && c.program === 'pytool');
    expect(pytoolRoot?.flags).toEqual(expect.arrayContaining(['-v', '--verbose']));
    const run = i.cli.find((c) => c.file === 'tool.py' && c.subcommands[0] === 'run');
    expect(run?.flags).toContain('--fast');
    expect(run?.program).toBe('pytool');
    const deploy = i.cli.find((c) => c.subcommands.join(' ') === 'deploy' && c.file === 'tool.py');
    expect(deploy?.flags).toEqual(expect.arrayContaining(['--dry-run', '--no-dry-run', '-n', '--count']));
    expect(deploy?.flagsComplete).toBe(true);
    expect(i.cli.find((c) => c.kind === 'bin')?.program).toBe('pytool');
  });
  it('requirements and pyproject packages with PEP 503 names', () => {
    expect(i.packages.find((p) => p.name === 'requests')).toMatchObject({ ecosystem: 'pypi', range: '==2.31.0', file: 'requirements.txt', line: 3 });
    expect(i.packages.find((p) => p.name === 'pyyaml')?.range).toBe('~=6.0');
    expect(i.packages.find((p) => p.name === 'uvicorn' && p.file === 'pyproject.toml')).toMatchObject({ range: '>=0.29', line: 6 });
    expect(i.packages.find((p) => p.name === 'pytest')?.dev).toBe(true);
    expect(i.packages.find((p) => p.ecosystem === 'runtime' && p.name === 'python')?.range).toBe('>=3.11');
  });
});

describe('OpenAPI, config, compose, k8s, Makefile', () => {
  const i = index('openapi-config');
  it('OpenAPI paths from YAML and JSON with operation lines', () => {
    expect(route(i, 'POST', '/orders')[0]).toMatchObject({ file: 'api/openapi.yaml', line: 9, framework: 'openapi' });
    expect(route(i, 'GET', '/orders/:param')[0]?.line).toBe(12);
    expect(route(i, 'DELETE', '/orders/:param')).toHaveLength(1);
    expect(route(i, 'GET', '/ping')[0]).toMatchObject({ file: 'api/spec.json', line: 4 });
  });
  it('config keys from YAML and JSON, not from OpenAPI, CI or compose', () => {
    expect(i.config.find((c) => c.keyPath === 'database.pool.max')).toMatchObject({ file: 'config/app.yaml', line: 7 });
    expect(i.config.find((c) => c.keyPath === 'feature.newUi')).toMatchObject({ file: 'config/settings.json', line: 4 });
    expect(i.configFiles).toEqual(['config/app.yaml', 'config/settings.json']);
  });
  it('compose and kubernetes env', () => {
    const by = (n: string) => i.env.find((e) => e.name === n);
    expect(by('DATABASE_URL')).toMatchObject({ source: 'compose', file: 'docker-compose.yml', line: 5 });
    expect(by('QUEUE_NAME')).toMatchObject({ source: 'compose', line: 10 });
    expect(by('LOG_LEVEL')?.source).toBe('compose');
    expect(by('PAYMENT_PROVIDER_URL')).toMatchObject({ source: 'kubernetes', file: 'deploy/k8s.yaml', line: 12 });
    expect(by('SECRET_TOKEN')?.source).toBe('kubernetes');
  });
  it('Makefile targets', () => {
    const t = i.cli.filter((c) => c.kind === 'make_target').map((c) => c.subcommands[0]);
    expect(t.sort()).toEqual(['build', 'seed']);
  });
  it('has no code env reads, so env is complete only from listings', () => {
    expect(i.coverage.env).toBe('complete');
    expect(i.coverage.packages).toBe('none');
  });
});

describe('Go', () => {
  const i = index('go-app');
  it('gin, groups, net/http and 1.22 patterns', () => {
    expect(route(i, 'GET', '/health')[0]).toMatchObject({ file: 'main.go', line: 12 });
    expect(route(i, 'POST', '/v1/orders')[0]?.line).toBe(14);
    expect(route(i, 'GET', '/v1/orders/:param')).toHaveLength(1);
    expect(route(i, 'ANY', '/legacy')).toHaveLength(1);
    expect(route(i, 'GET', '/items/:param')).toHaveLength(1);
    expect(i.routes.map((r) => r.path)).not.toContain('/commented');
  });
  it('os.Getenv and LookupEnv', () => {
    expect(i.env.filter((e) => e.file === 'main.go').map((e) => e.name).sort()).toEqual(['ORDERS_DB_URL', 'ORDERS_MODE']);
  });
  it('cobra hierarchy with persistent flags', () => {
    const ship = i.cli.find((c) => c.subcommands.join(' ') === 'ship');
    expect(ship).toMatchObject({ program: 'orders', file: 'cmd/ship.go', line: 5 });
    expect(ship?.flags).toEqual(expect.arrayContaining(['--express', '-e', '--carrier', '--config']));
    expect(i.cli.some((c) => c.program === 'orders' && c.subcommands.length === 0)).toBe(true);
  });
  it('go.mod direct dependencies only', () => {
    const names = i.packages.filter((p) => p.ecosystem === 'go').map((p) => p.name);
    expect(names.sort()).toEqual(['github.com/gin-gonic/gin', 'github.com/spf13/cobra']);
    expect(i.packages.find((p) => p.ecosystem === 'runtime' && p.name === 'go')?.range).toBe('1.22');
  });
});

describe('Java', () => {
  const i = index('java-app');
  it('Spring class prefix, verbs and RequestMapping method', () => {
    expect(route(i, 'GET', '/api/orders/:param')[0]).toMatchObject({ file: 'src/main/java/com/acme/OrderController.java', line: 10 });
    expect(route(i, 'POST', '/api/orders')).toHaveLength(1);
    expect(route(i, 'PUT', '/api/orders/bulk')).toHaveLength(1);
    expect(i.routes.map((r) => r.path)).not.toContain('/api/orders/commented');
  });
  it('JAX-RS', () => {
    expect(route(i, 'GET', '/ping/:param')).toHaveLength(1);
  });
  it('System.getenv and pom dependencies', () => {
    expect(i.env.find((e) => e.name === 'ORDERS_URL')?.line).toBe(19);
    expect(i.packages.find((p) => p.name === 'org.springframework.boot:spring-boot-starter-web')).toMatchObject({ ecosystem: 'maven', range: '3.2.0', dev: false });
    expect(i.packages.find((p) => p.name === 'junit:junit')?.dev).toBe(true);
  });
});

describe('parsers the demo fixture does not use', () => {
  const repo = { provider: 'github' as const, fullName: 'o/r', ref: 'main', sha: 'a'.repeat(40), indexedAt: 'x' };
  const finish = (files: { path: string; text: string }[]): RepoIndex =>
    buildRepoIndex(files, { repo, stats: { filesIndexed: files.length, filesSkipped: 0, truncated: false } });

  it('keeps static Click flags but marks computed aliases incomplete', () => {
    const i = finish([
      {
        path: 'cli.py',
        text: [
          'import click',
          '@click.group("ops")',
          'def ops(): pass',
          '@ops.command()',
          '@click.option("--verbose", make_alias())',
          'def sync(): pass',
          '@ops.command()',
          '@click.option("--limit", default=get_default(),)',
          'def clean(): pass',
        ].join('\n'),
      },
    ]);
    const sync = i.cli.find((c) => c.subcommands[0] === 'sync');
    const clean = i.cli.find((c) => c.subcommands[0] === 'clean');
    expect(sync?.flags).toContain('--verbose');
    expect(sync).toMatchObject({ flagsComplete: false });
    expect(clean).toMatchObject({ flagsComplete: true });
    expect(i.coverage.cli).toBe('partial');
  });

  it('reads minimist flags from an extensionless node bin and names them from package.json', () => {
    const i = finish([
      { path: 'package.json', text: '{ "name": "http-server", "bin": { "http-server": "./bin/http-server" } }' },
      {
        path: 'bin/http-server',
        text: [
          '#!/usr/bin/env node',
          "var argv = require('minimist')(process.argv.slice(2), { alias: { header: 'H' }, boolean: ['proxy-all'] });",
          "var port = argv.p || argv.port || process.env.PORT;",
          "var dir = argv['dir-overrides-404'];",
          "var panic = argv['panic'] || process.env.NODE_HTTP_SERVER_NO_PANIC; // --no-panic",
          'if (argv.header) {}',
        ].join('\n'),
      },
    ]);
    const cmd = i.cli.find((c) => c.kind === 'command' && c.program === 'http-server');
    expect(cmd?.flags).toEqual(expect.arrayContaining(['-p', '--port', '--dir-overrides-404', '-H', '--header', '--proxy-all', '--no-panic']));
    expect(cmd?.flags).not.toContain('-dir-overrides-404');
    expect(cmd?.flags).not.toContain('--slice');
    expect(i.env.some((e) => e.name === 'PORT' && e.file === 'bin/http-server')).toBe(true);
    expect(i.coverage.cli).toBe('complete');
  });

  it('checks direct minimist fallbacks in an option table without using conditional defaults', () => {
    const packageJson = { path: 'package.json', text: '{"bin":{"http-server":"./bin/http-server"}}' };
    const shebang = '#!/usr/bin/env node';
    const binding = "var argv = require('minimist')(process.argv.slice(2), { alias: { header: 'H' }, boolean: ['proxy-all'] });";
    const source = [
      shebang,
      binding,
      'var port = argv.p || process.env.PORT,',
      "    host = argv.a || '::',",
      "    ext = argv.e === true ? 'html' : argv.e;",
      "const cache = argv['cache'] || 3600;",
      'if (argv.a) console.log(host);',
    ].join('\n');
    const readme = [
      '    http-server [path] [options]', '',
      '| Command | Description | Defaults |  ',
      '| --- | --- | --- |',
      '| `-p` | Port | 8080',
      '| `-a` | Address | 0.0.0.0 |',
      '| `-e` | Extension | `html` |',
      '| `--cache` | Cache time | 3600 |',
    ].join('\n');
    const defaults = extractClaimsFromText(readme).claims.filter(({ normalized }) =>
      normalized.type === 'cli' && normalized.defaultValue !== undefined
    );
    const [, address, , cache] = defaults;
    if (!address || !cache) throw new Error('Expected address and cache default claims');
    const indexed = finish([packageJson, { path: 'bin/http-server', text: source }]);
    expect(defaults.map(({ raw }) => raw)).toEqual(['8080', '0.0.0.0', 'html', '3600']);
    expect(defaults.map((claim) => matchClaim(claim, indexed))).toMatchObject([
      { verdict: 'unknown' },
      { verdict: 'contradicted', reason: 'cli_default_mismatch', evidence: [{ file: 'bin/http-server', line: 4 }] },
      { verdict: 'unknown' },
      { verdict: 'verified', reason: 'cli_default_matches', evidence: [{ file: 'bin/http-server', line: 6 }] },
    ]);
    const configured = finish([packageJson, {
      path: 'bin/http-server',
      text: source.replace("alias: { header: 'H' }", "default: { a: '0.0.0.0' }"),
    }]);
    expect(defaults.map((claim) => matchClaim(claim, configured).verdict)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    const conflicting = finish([packageJson, {
      path: 'bin/http-server',
      text: source + "\nconst otherAddress = argv.a || '127.0.0.1';",
    }]);
    expect(matchClaim(address, conflicting).verdict).toBe('unknown');
    const conditional = finish([packageJson, {
      path: 'bin/http-server',
      text: [
        shebang,
        binding,
        "var host = '0.0.0.0';",
        'if (process.env.IPV6) {',
        "  host = argv.a || '::';",
        '}',
        'if (process.env.USE_CACHE)',
        '  var cache = argv.cache || 3600;',
      ].join('\n'),
    }]);
    expect(matchClaim(address, conditional).verdict).toBe('unknown');
    expect(matchClaim(cache, conditional).verdict).toBe('unknown');
  });

  it('reads node:util parseArgs options', () => {
    const i = finish([
      { path: 'package.json', text: '{ "bin": { "json-server": "src/bin.ts" } }' },
      {
        path: 'src/bin.ts',
        text: [
          "import { parseArgs } from 'node:util';",
          'const { values } = parseArgs({ options: { port: { type: "string", short: "p" }, static: { type: "string", short: "s" }, help: { type: "boolean" } } });',
          'void values;',
        ].join('\n'),
      },
    ]);
    const cmd = i.cli.find((c) => c.kind === 'command' && c.program === 'json-server');
    expect(cmd?.flags).toEqual(expect.arrayContaining(['--port', '-p', '--static', '-s']));
  });

  it('reads arg === flag comparisons', () => {
    const i = finish([
      { path: 'package.json', text: '{ "name": "nodemon", "bin": { "nodemon": "bin/nodemon.js" } }' },
      {
        path: 'bin/nodemon.js',
        text: "var args = process.argv.slice(2);\nif (arg === '--dump') {}\nelse if (arg === '--legacy-watch' || arg === '-L') {}",
      },
    ]);
    const cmd = i.cli.find((c) => c.kind === 'command');
    expect(cmd?.program).toBe('nodemon');
    expect(cmd?.flags).toEqual(expect.arrayContaining(['--dump', '--legacy-watch', '-L']));
    expect(cmd?.flags).not.toContain('--inspect');
  });

  it('records an explicit fall-through for flags left to a child process', () => {
    const i = finish([
      { path: 'package.json', text: '{ "name": "nodemon", "bin": { "nodemon": "bin/nodemon.js" } }' },
      {
        path: 'lib/cli/parse.js',
        text: [
          'var args = process.argv.slice(2);',
          'if (parseOption(args[i]) !== false) { args.splice(i, 1); }',
          "function parseOption(arg) { if (arg === '--dump') return true; return false; }",
        ].join('\n'),
      },
    ]);
    const cmd = i.cli.find((c) => c.kind === 'command');
    expect(cmd).toMatchObject({ program: 'nodemon', passesUnknownFlags: true });
  });

  it('does not infer pass-through from an unrelated false return', () => {
    const i = finish([
      { path: 'package.json', text: '{ "name": "tool", "bin": "cli.js" }' },
      {
        path: 'cli.js',
        text: "var args = process.argv.slice(2);\nif (arg === '--dump') {}\nfunction valid() { return false; }",
      },
    ]);
    expect(i.cli.find((c) => c.kind === 'command')?.passesUnknownFlags).toBeUndefined();
  });

  it('indexes tinyhttp routes as express-style paths', () => {
    const i = finish([
      {
        path: 'src/app.ts',
        text: "import { App } from '@tinyhttp/app';\nexport function createApp() {\n  const app = new App();\n  app.get('/:name', handler);\n  app.post('/:name', handler);\n  app.delete('/:name/:id', handler);\n}\n",
      },
    ]);
    expect(i.coverage.routes).toBe('complete');
    expect(route(i, 'GET', '/:param')).toHaveLength(1);
    expect(route(i, 'POST', '/:param')).toHaveLength(1);
    expect(route(i, 'DELETE', '/:param/:param')).toHaveLength(1);
  });

  it('names a Go flag program from Usage and keeps both dash forms', () => {
    const i = finish([
      {
        path: 'internal/cli/main.go',
        text: [
          'package cli',
          'import "flag"',
          'func Main() {',
          '  flag.String("source", "", "")',
          '  flag.String("database", "", "")',
          '  flag.Usage = func() {',
          '    fmt.Fprintf(os.Stderr, `Usage: migrate OPTIONS COMMAND`)',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    const cmd = i.cli.find((c) => c.kind === 'command');
    expect(cmd?.program).toBe('migrate');
    expect(cmd?.flags).toEqual(expect.arrayContaining(['--source', '-source', '--database', '-database']));
  });
});

describe('truncation', () => {
  it('sets every populated kind to partial when the snapshot was cut', () => {
    const i = index('payments-api-mini', { truncated: true });
    expect(i.stats.truncated).toBe(true);
    for (const k of Object.values(i.coverage)) expect(k).toBe('partial');
  });
});

describe('unsupported languages', () => {
  it('a Rust file makes routes, env and cli partial', () => {
    const files = [...loadFixture('payments-api-mini'), { path: 'native/lib.rs', text: 'fn main() {}' }];
    const i = buildRepoIndex(files, {
      repo: { provider: 'github', fullName: 'o/r', ref: 'main', sha: 'a'.repeat(40), indexedAt: 'x' },
      stats: { filesIndexed: files.length, filesSkipped: 0, truncated: false },
    });
    expect(i.coverage.routes).toBe('partial');
    expect(i.coverage.env).toBe('partial');
    expect(i.coverage.cli).toBe('partial');
  });
});
