import { describe, expect, it } from 'vitest';
import { GitHubSource } from '../../src/repo/github';
import { DEFAULT_LIMITS as DEFAULTS, RepoError, createCounters, toReasonCode } from '../../src/repo/source';
import type { RepoErrorReason } from '../../src/repo/source';
import { buildTarGz, fakeFetch, filesToEntries, loadFixture } from './helpers';
import type { Route } from './helpers';

const SHA = 'e9c026c611c1160eaad50da00be4e676b626018f';
const TOKEN = 'github_pat_SECRET_TOKEN_VALUE_123456';
const NOW = Date.parse('2026-11-15T12:00:00Z');

function source(routes: Route[], token?: string) {
  const f = fakeFetch(routes);
  const s = new GitHubSource({ owner: 'o', repo: 'r', fetch: f.fetch, now: () => NOW, ...(token ? { token } : {}) });
  return { s, f };
}

async function failure(p: Promise<unknown>): Promise<RepoError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(RepoError);
    return e as RepoError;
  }
  throw new Error('expected a RepoError');
}

describe('GitHubSource.resolveRef', () => {
  it('makes one REST call with the sha media type', async () => {
    const { s, f } = source([() => ({ body: `${SHA}\n` })]);
    expect(await s.resolveRef('main')).toEqual({ sha: SHA, ref: 'main' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe('https://api.github.com/repos/o/r/commits/main');
    expect(f.calls[0]?.headers['Accept']).toBe('application/vnd.github.sha');
    expect(f.calls[0]?.headers['Authorization']).toBeUndefined();
  });

  it('uses HEAD for the default branch and encodes ref segments', async () => {
    const { s, f } = source([() => ({ body: SHA })]);
    expect((await s.resolveRef()).ref).toBe('HEAD');
    await s.resolveRef('feature/x y'.replace(' ', '_'));
    expect(f.calls[0]?.url.endsWith('/commits/HEAD')).toBe(true);
    expect(f.calls[1]?.url.endsWith('/commits/feature/x_y')).toBe(true);
  });

  it('rejects invalid refs without a request and unexpected bodies', async () => {
    const { s, f } = source([() => ({ body: '<html>' })]);
    expect((await failure(s.resolveRef('../etc'))).reason).toBe('ref_not_found');
    expect((await failure(s.resolveRef('-x'))).reason).toBe('ref_not_found');
    expect(f.calls).toHaveLength(0);
    expect((await failure(s.resolveRef('main'))).reason).toBe('upstream_error');
  });

  it('sends the token as a Bearer header', async () => {
    const { s, f } = source([() => ({ body: SHA })], TOKEN);
    await s.resolveRef('main');
    expect(f.calls[0]?.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });
});

describe('error mapping', () => {
  const cases: Array<[string, { status: number; headers?: Record<string, string>; body?: string }, RepoErrorReason, string | undefined]> = [
    ['404', { status: 404 }, 'repo_not_found_or_private', undefined],
    ['401', { status: 401 }, 'repo_not_found_or_private', undefined],
    ['422', { status: 422 }, 'ref_not_found', undefined],
    ['500', { status: 500 }, 'upstream_error', undefined],
    ['403 plain', { status: 403, body: 'forbidden' }, 'repo_not_found_or_private', undefined],
    ['403 remaining 0', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794766704' } }, 'rate_limited', new Date(1794766704 * 1000).toISOString()],
    ['429 retry-after', { status: 429, headers: { 'retry-after': '90' } }, 'rate_limited', new Date(NOW + 90_000).toISOString()],
    ['403 secondary', { status: 403, headers: { 'retry-after': '30' }, body: 'You have exceeded a secondary rate limit' }, 'rate_limited', new Date(NOW + 30_000).toISOString()],
    ['403 body only', { status: 403, body: 'API rate limit exceeded for 1.2.3.4' }, 'rate_limited', undefined],
  ];
  for (const [name, res, reason, resetAt] of cases) {
    it(`REST ${name} -> ${reason}`, async () => {
      const { s } = source([() => res], TOKEN);
      const e = await failure(s.resolveRef('main'));
      expect(e.reason).toBe(reason);
      expect(e.resetAt).toBe(resetAt);
      expect(e.message).not.toContain(TOKEN);
    });
  }

  it('maps a network failure to upstream_error without leaking details', async () => {
    const s = new GitHubSource({ owner: 'o', repo: 'r', token: TOKEN, fetch: async () => { throw new Error(`boom ${TOKEN}`); } });
    const e = await failure(s.resolveRef('main'));
    expect(e.reason).toBe('upstream_error');
    expect(e.message).not.toContain(TOKEN);
  });

  it('turns every reason into Unknown reason codes, never a verdict', () => {
    expect(toReasonCode('repo_not_found_or_private')).toBe('repo_not_found_or_private');
    expect(toReasonCode('rate_limited')).toBe('rate_limited');
    expect(toReasonCode('tarball_too_large')).toBe('tarball_too_large');
    expect(toReasonCode('upstream_error')).toBe('index_missing');
    expect(toReasonCode('ref_not_found')).toBe('index_missing');
    expect(toReasonCode('invalid_repo_url')).toBe('index_missing');
  });
});

describe('GitHubSource.snapshot', () => {
  const tarball = buildTarGz(`o-r-${SHA.slice(0, 7)}`, filesToEntries(loadFixture('payments-api-mini')));

  it('downloads one tarball from codeload and yields text files', async () => {
    const { s, f } = source([() => ({ body: tarball, headers: { 'content-length': String(tarball.length) } })]);
    const counters = createCounters();
    const files = [];
    for await (const file of s.snapshot(SHA, undefined, counters)) files.push(file);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe(`https://codeload.github.com/o/r/tar.gz/${SHA}`);
    expect(files.some((x) => x.path === 'src/routes.ts')).toBe(true);
    expect(counters.filesIndexed).toBe(files.length);
  });

  it('only talks to the declared GitHub hosts, token included', async () => {
    const { s, f } = source([(r) => (r.url.startsWith('https://api.github.com/') ? { body: SHA } : { body: tarball })], TOKEN);
    await s.resolveRef('main');
    for await (const x of s.snapshot(SHA)) void x;
    expect(new Set(f.calls.map((c) => new URL(c.url).host))).toEqual(new Set(['api.github.com', 'codeload.github.com']));
  });

  it('maps 404, rate limits and oversize', async () => {
    expect((await failure(drain(source([() => ({ status: 404 })]).s.snapshot(SHA)))).reason).toBe('repo_not_found_or_private');
    expect((await failure(drain(source([() => ({ status: 429, headers: { 'retry-after': '5' } })]).s.snapshot(SHA)))).reason).toBe('rate_limited');
    expect((await failure(drain(source([() => ({ body: 'x', headers: { 'content-length': String(26 * 1024 * 1024) } })]).s.snapshot(SHA)))).reason).toBe('tarball_too_large');
    expect((await failure(drain(source([() => ({ body: Buffer.alloc(2000) })]).s.snapshot(SHA, { ...DEFAULTS, maxCompressedBytes: 1000 })))).reason).toBe('tarball_too_large');
  });

  it('maps an unpacked size bomb to tarball_too_large and a corrupt archive to upstream_error', async () => {
    const big = buildTarGz('t', [{ path: 'a.ts', data: 'a'.repeat(300_000) }]);
    expect((await failure(drain(source([() => ({ body: big })]).s.snapshot(SHA, { ...DEFAULTS, maxUncompressedBytes: 100_000 })))).reason).toBe('tarball_too_large');
    expect((await failure(drain(source([() => ({ body: Buffer.from('garbage') })]).s.snapshot(SHA)))).reason).toBe('upstream_error');
  });

  it('requires a full commit id', async () => {
    expect((await failure(drain(source([]).s.snapshot('main')))).reason).toBe('ref_not_found');
  });
});

async function drain(it: AsyncIterable<unknown>): Promise<void> {
  for await (const x of it) void x;
}

describe('permalink and constructor', () => {
  const { s } = source([]);
  it('encodes each path segment and keeps slashes', () => {
    expect(s.permalink(SHA, 'src/routes.ts', 88)).toBe(`https://github.com/o/r/blob/${SHA}/src/routes.ts#L88`);
    expect(s.permalink(SHA, 'docs/a b/#x?.md', 3)).toBe(`https://github.com/o/r/blob/${SHA}/docs/a%20b/%23x%3F.md#L3`);
  });
  it('rejects invalid owner, repo and token formats', () => {
    const f = fakeFetch([]).fetch;
    expect(() => new GitHubSource({ owner: 'a/b', repo: 'r', fetch: f })).toThrow(RepoError);
    expect(() => new GitHubSource({ owner: 'o', repo: '..', fetch: f })).toThrow(RepoError);
    expect(() => new GitHubSource({ owner: 'o', repo: 'r', token: 'bad token\nX: y', fetch: f })).toThrow(RepoError);
  });
});
