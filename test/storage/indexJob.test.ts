import { beforeEach, describe, expect, it } from 'vitest';
import { runIndexJob } from '../../src/consumers/indexJob';
import type { IndexJobDeps } from '../../src/consumers/indexJob';
import { DEFAULT_LIMITS } from '../../src/repo/source';
import { clearIndexCache, loadIndex, readPointer } from '../../src/storage/indexStore';
import { pointerKey, repoKeyOf } from '../../src/storage/keys';
import { saveSettings, setToken } from '../../src/storage/settings';
import { getStatus } from '../../src/storage/status';
import { buildTarGz, fakeFetch, filesToEntries, loadFixture } from '../repo/helpers';
import type { Route } from '../repo/helpers';
import { FakeKvs } from './fakeKvs';

const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const KEY = repoKeyOf('github', 'himanshu748/payments-api', 'main');
const TOKEN = 'github_pat_SECRET_TOKEN_VALUE_123456';
let t = Date.parse('2026-11-15T10:00:00Z');

const tarball = (sha: string, extra: Array<{ path: string; data: string }> = []) =>
  buildTarGz(`himanshu748-payments-api-${sha.slice(0, 7)}`, [...filesToEntries(loadFixture('payments-api-mini')), ...extra]);

function api(sha: string): Route {
  return (r) => (r.url.startsWith('https://api.github.com/') ? { body: sha } : undefined);
}
function code(body: Buffer): Route {
  return (r) => (r.url.startsWith('https://codeload.github.com/') ? { body } : undefined);
}

async function setup(routes: Route[], opts: { token?: boolean } = {}) {
  const kvs = new FakeKvs();
  await saveSettings(kvs, { repoUrl: 'https://github.com/himanshu748/payments-api', ref: 'main' }, () => t);
  if (opts.token) await setToken(kvs, 'github', TOKEN);
  const f = fakeFetch(routes);
  const deps: IndexJobDeps = { kvs, fetch: f.fetch, now: () => t };
  return { kvs, f, deps };
}

beforeEach(() => {
  t = Date.parse('2026-11-15T10:00:00Z');
  clearIndexCache();
});

describe('runIndexJob', () => {
  it('resolves, downloads, builds and stores an index with POST /v2/payments at src/routes.ts:88', async () => {
    const { kvs, f, deps } = await setup([api(SHA1), code(tarball(SHA1))]);
    const r = await runIndexJob(deps, { body: { repoKey: KEY, reason: 'missing' } });
    expect(r).toMatchObject({ outcome: 'indexed', sha: SHA1 });
    expect(f.calls.map((c) => new URL(c.url).host)).toEqual(['api.github.com', 'codeload.github.com']);
    const loaded = await loadIndex(kvs, KEY);
    expect(loaded?.index.repo).toMatchObject({ provider: 'github', fullName: 'himanshu748/payments-api', ref: 'main', sha: SHA1 });
    expect(loaded?.index.routes.find((x) => x.method === 'POST' && x.path === '/v2/payments')).toMatchObject({ file: 'src/routes.ts', line: 88 });
    expect(loaded?.index.env.some((e) => e.name === 'PAYMENTS_API_KEY' && e.file === 'src/config.ts')).toBe(true);
    expect(loaded?.index.cli.some((c) => c.program === 'payments' && c.subcommands[0] === 'refund' && c.flags.includes('--confirm') && c.flags.includes('--reason'))).toBe(true);
    expect(loaded?.index.cli.some((c) => c.kind === 'script' && c.subcommands[1] === 'db:migrate')).toBe(true);
    expect(loaded?.index.stats.truncated).toBe(false);
    expect(await getStatus(kvs, KEY)).toMatchObject({ state: 'ok', sha: SHA1 });
    // pointer is the last write
    expect(kvs.writeOrder().filter((k) => k.startsWith('idx:')).at(-1)).toBe(pointerKey(KEY));
  });

  it('does nothing when the commit has not changed, rebuilds when it has', async () => {
    const { kvs, f, deps } = await setup([api(SHA1), code(tarball(SHA1))]);
    await runIndexJob(deps, {});
    t += 11 * 60_000;
    expect(await runIndexJob(deps, {})).toEqual({ outcome: 'unchanged', sha: SHA1 });
    expect(f.calls.filter((c) => c.url.includes('codeload'))).toHaveLength(1);
    const f2 = fakeFetch([api(SHA2), code(tarball(SHA2, [{ path: 'src/extra.ts', data: "import express from 'express';\nconst a = express();\na.get('/extra', h);\n" }]))]);
    t += 11 * 60_000;
    expect(await runIndexJob({ ...deps, fetch: f2.fetch }, {})).toMatchObject({ outcome: 'indexed', sha: SHA2 });
    expect((await readPointer(kvs, KEY))?.previous?.sha).toBe(SHA1);
    expect((await loadIndex(kvs, KEY))?.index.routes.some((r) => r.path === '/extra')).toBe(true);
  });

  it('uses the token only for GitHub hosts and never stores it in plain KVS or status', async () => {
    const { kvs, f, deps } = await setup([api(SHA1), code(tarball(SHA1))], { token: true });
    await runIndexJob(deps, {});
    expect(f.calls.every((c) => c.headers['Authorization'] === `Bearer ${TOKEN}`)).toBe(true);
    expect(f.calls.every((c) => ['api.github.com', 'codeload.github.com'].includes(new URL(c.url).host))).toBe(true);
    expect(JSON.stringify([...kvs.data.entries()])).not.toContain(TOKEN);
  });

  it('keeps the last good index and records rate_limited with the reset time', async () => {
    const { kvs, deps } = await setup([api(SHA1), code(tarball(SHA1))]);
    await runIndexJob(deps, {});
    t += 11 * 60_000;
    const limited = fakeFetch([() => ({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794766704' } })]);
    const r = await runIndexJob({ ...deps, fetch: limited.fetch }, { body: { reason: 'stale' } });
    expect(r).toEqual({ outcome: 'error', reason: 'rate_limited', resetAt: new Date(1794766704 * 1000).toISOString() });
    expect(await getStatus(kvs, KEY)).toMatchObject({ state: 'error', reason: 'rate_limited', sha: SHA1, resetAt: new Date(1794766704 * 1000).toISOString() });
    expect((await loadIndex(kvs, KEY))?.index.repo.sha).toBe(SHA1);
  });

  it('builds the first index from the archive when the REST API rate limit blocks the commit lookup', async () => {
    const ARCHIVE_SHA = '0123456789abcdef0123456789abcdef01234567'; // the commit id buildTar writes in the archive
    const limitedApi: Route = (r) => (r.url.startsWith('https://api.github.com/') ? { status: 403, headers: { 'x-ratelimit-remaining': '0' } } : undefined);
    const { kvs, f, deps } = await setup([limitedApi, code(tarball(ARCHIVE_SHA))]);
    const r = await runIndexJob(deps, { body: { repoKey: KEY, reason: 'manual' } });
    expect(r).toMatchObject({ outcome: 'indexed', sha: ARCHIVE_SHA });
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/himanshu748/payments-api/commits/main',
      'https://codeload.github.com/himanshu748/payments-api/tar.gz/main',
    ]);
    expect((await loadIndex(kvs, KEY))?.index.repo).toMatchObject({ ref: 'main', sha: ARCHIVE_SHA });
    expect(await getStatus(kvs, KEY)).toMatchObject({ state: 'ok', sha: ARCHIVE_SHA });
  });

  it('maps 404 to repo_not_found_or_private and oversize to tarball_too_large, leaving no index behind', async () => {
    const a = await setup([() => ({ status: 404 })]);
    expect(await runIndexJob(a.deps, {})).toMatchObject({ outcome: 'error', reason: 'repo_not_found_or_private' });
    expect(await readPointer(a.kvs, KEY)).toBeUndefined();
    const b = await setup([api(SHA1), code(tarball(SHA1))]);
    const small = { ...DEFAULT_LIMITS, maxCompressedBytes: 100 };
    expect(await runIndexJob({ ...b.deps, limits: small }, {})).toMatchObject({ outcome: 'error', reason: 'tarball_too_large' });
    expect(await readPointer(b.kvs, KEY)).toBeUndefined();
    expect((await getStatus(b.kvs, KEY))?.reason).toBe('tarball_too_large');
  });

  it('marks coverage partial and stats truncated when the file limit cuts the snapshot', async () => {
    const { kvs, deps } = await setup([api(SHA1), code(tarball(SHA1))]);
    await runIndexJob({ ...deps, limits: { ...DEFAULT_LIMITS, maxFiles: 3 } }, {});
    const idx = (await loadIndex(kvs, KEY))?.index;
    expect(idx?.stats).toMatchObject({ filesIndexed: 3, truncated: true });
    expect(idx?.stats.filesSkipped).toBeGreaterThan(0);
    expect(Object.values(idx?.coverage ?? {}).every((c) => c === 'partial')).toBe(true);
  });

  it('ignores events for another repo, missing settings and in-flight duplicates', async () => {
    const { kvs, deps } = await setup([api(SHA1), code(tarball(SHA1))]);
    expect(await runIndexJob(deps, { body: { repoKey: 'gh#3Aevil#2Frepo#40main' } })).toEqual({ outcome: 'skipped', why: 'repo_changed' });
    expect(await runIndexJob({ ...deps, kvs: new FakeKvs() }, {})).toEqual({ outcome: 'skipped', why: 'no_settings' });
    await kvs.set(`status:${KEY}`, { state: 'indexing', updatedAt: new Date(t - 30_000).toISOString() });
    expect(await runIndexJob(deps, {})).toEqual({ outcome: 'skipped', why: 'in_progress' });
    await kvs.set(`status:${KEY}`, { state: 'indexing', updatedAt: new Date(t - 10 * 60_000).toISOString() });
    expect(await runIndexJob(deps, {})).toMatchObject({ outcome: 'indexed' });
  });

  it('never reports success for an unreadable archive', async () => {
    const { kvs, deps } = await setup([api(SHA1), code(Buffer.from('garbage'))]);
    expect(await runIndexJob(deps, {})).toMatchObject({ outcome: 'error', reason: 'index_missing' });
    expect(await readPointer(kvs, KEY)).toBeUndefined();
  });
});
