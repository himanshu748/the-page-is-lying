import { describe, expect, it } from 'vitest';
import { BitbucketSource } from '../../src/repo/bitbucket';
import { RepoError, createCounters } from '../../src/repo/source';
import { buildTarGz, fakeFetch, filesToEntries, loadFixture } from './helpers';
import type { Route } from './helpers';

const SHA = 'd3614bdbe76a86ac070978384b4fd3cc90f86429';

function source(routes: Route[], token?: string) {
  const f = fakeFetch(routes);
  return { s: new BitbucketSource({ workspace: 'ws', repo: 'rp', fetch: f.fetch, now: () => 0, ...(token ? { token } : {}) }), f };
}

const branch = (hash = SHA) => JSON.stringify({ name: 'main', target: { type: 'commit', hash } });

describe('BitbucketSource.resolveRef', () => {
  it('resolves a named branch with one call', async () => {
    const { s, f } = source([() => ({ body: branch() })]);
    expect(await s.resolveRef('main')).toEqual({ sha: SHA, ref: 'main' });
    expect(f.calls.map((c) => c.url)).toEqual(['https://api.bitbucket.org/2.0/repositories/ws/rp/refs/branches/main']);
  });

  it('looks up the main branch for the default ref', async () => {
    const { s, f } = source([(r) => (r.url.includes('mainbranch') ? { body: JSON.stringify({ mainbranch: { name: 'trunk' } }) } : { body: branch() })]);
    expect(await s.resolveRef()).toEqual({ sha: SHA, ref: 'HEAD' });
    expect(f.calls[1]?.url).toBe('https://api.bitbucket.org/2.0/repositories/ws/rp/refs/branches/trunk');
  });

  it('falls back to tags, then tells a missing ref from a missing repo', async () => {
    const tags = source([(r) => (r.url.includes('/refs/tags/') ? { body: branch() } : { status: 404 })]);
    expect((await tags.s.resolveRef('v1')).sha).toBe(SHA);
    const noRef = source([(r) => (r.url.endsWith('?fields=name') ? { body: '{}' } : { status: 404 })]);
    await expect(noRef.s.resolveRef('nope')).rejects.toMatchObject({ reason: 'ref_not_found' });
    const noRepo = source([() => ({ status: 404 })]);
    await expect(noRepo.s.resolveRef('main')).rejects.toMatchObject({ reason: 'repo_not_found_or_private' });
  });

  it('maps 429 with Retry-After and auth failures', async () => {
    await expect(source([() => ({ status: 429, headers: { 'retry-after': '60' } })]).s.resolveRef('main')).rejects.toMatchObject({ reason: 'rate_limited', resetAt: new Date(60_000).toISOString() });
    await expect(source([() => ({ status: 403 })]).s.resolveRef('main')).rejects.toMatchObject({ reason: 'repo_not_found_or_private' });
    await expect(source([() => ({ status: 503 })]).s.resolveRef('main')).rejects.toMatchObject({ reason: 'upstream_error' });
    await expect(source([() => ({ body: branch('nothex') })]).s.resolveRef('main')).rejects.toMatchObject({ reason: 'upstream_error' });
  });
});

describe('BitbucketSource.snapshot', () => {
  const tarball = buildTarGz(`ws-rp-${SHA.slice(0, 12)}`, filesToEntries(loadFixture('payments-api-mini')));

  it('downloads bitbucket.org/{ws}/{repo}/get/{sha}.tar.gz and yields files', async () => {
    const { s, f } = source([() => ({ body: tarball })], 'tok_123456789');
    const counters = createCounters();
    const files = [];
    for await (const x of s.snapshot(SHA, undefined, counters)) files.push(x);
    expect(f.calls[0]?.url).toBe(`https://bitbucket.org/ws/rp/get/${SHA}.tar.gz`);
    expect(f.calls[0]?.headers['Authorization']).toBe('Bearer tok_123456789');
    expect(files.some((x) => x.path === 'src/routes.ts')).toBe(true);
  });

  it('maps 404 and oversize', async () => {
    const run = async (routes: Route[]) => {
      try {
        for await (const x of source(routes).s.snapshot(SHA, { maxCompressedBytes: 100, maxUncompressedBytes: 1e6, maxFiles: 10, maxFileBytes: 1e6, maxTreePaths: 100, skipDirs: new Set() })) void x;
      } catch (e) {
        return e as RepoError;
      }
      throw new Error('no error');
    };
    expect((await run([() => ({ status: 404 })])).reason).toBe('repo_not_found_or_private');
    expect((await run([() => ({ body: tarball })])).reason).toBe('tarball_too_large');
  });

  it('builds permalinks and validates names', () => {
    const { s } = source([]);
    expect(s.permalink(SHA, 'src/a b.ts', 4)).toBe(`https://bitbucket.org/ws/rp/src/${SHA}/src/a%20b.ts#lines-4`);
    expect(() => new BitbucketSource({ workspace: '../x', repo: 'r', fetch: fakeFetch([]).fetch })).toThrow(RepoError);
  });
});
