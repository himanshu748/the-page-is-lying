import { beforeEach, describe, expect, it } from 'vitest';
import { buildRepoIndex } from '../../src/core/index/build';
import { RepoError } from '../../src/repo/source';
import type { RepoSource } from '../../src/repo/source';
import { FRESH_MS, HEAD_TTL_MS, getHeadSha, getIndexForCheck } from '../../src/storage/freshness';
import type { FreshnessDeps } from '../../src/storage/freshness';
import { clearIndexCache, writeIndex } from '../../src/storage/indexStore';
import { headKey, repoKeyOf } from '../../src/storage/keys';
import { getStatus, setStatus } from '../../src/storage/status';
import { loadFixture } from '../repo/helpers';
import { FakeKvs } from './fakeKvs';

const REPO_KEY = repoKeyOf('github', 'o/r', 'main');
const SHA_OLD = 'a'.repeat(40);
const SHA_NEW = 'b'.repeat(40);

function fakeSource(script: Array<() => string>): { source: RepoSource; calls: () => number } {
  let n = 0;
  const source: RepoSource = {
    provider: 'github',
    fullName: 'o/r',
    async resolveRef(ref) {
      const fn = script[Math.min(n, script.length - 1)] as () => string;
      n++;
      return { sha: fn(), ref: ref ?? 'HEAD' };
    },
    // eslint-disable-next-line require-yield
    async *snapshot() {
      throw new Error('not used');
    },
    permalink: () => '',
  };
  return { source, calls: () => n };
}

const failing = (reason: ConstructorParameters<typeof RepoError>[0], resetAt?: string) => () => {
  throw new RepoError(reason, 'x', resetAt);
};

let t = Date.parse('2026-11-15T10:00:00Z');
const now = () => t;

async function seed(kvs: FakeKvs, indexedAt: number, sha = SHA_OLD) {
  const files = loadFixture('payments-api-mini');
  const index = buildRepoIndex(files, {
    repo: { provider: 'github', fullName: 'o/r', ref: 'main', sha, indexedAt: new Date(indexedAt).toISOString() },
    stats: { filesIndexed: files.length, filesSkipped: 0, truncated: false },
  });
  await writeIndex(kvs, REPO_KEY, index);
}

function deps(kvs: FakeKvs, source: RepoSource, enqueued: unknown[]): FreshnessDeps {
  return { kvs, now, getSource: async () => source, enqueue: async (b) => void enqueued.push(b) };
}

beforeEach(() => {
  t = Date.parse('2026-11-15T10:00:00Z');
  clearIndexCache();
});

describe('getHeadSha', () => {
  it('calls the REST API at most once per 10 minutes', async () => {
    const kvs = new FakeKvs();
    const { source, calls } = fakeSource([() => SHA_OLD, () => SHA_NEW]);
    const a = await getHeadSha({ kvs, source, repoKey: REPO_KEY, ref: 'main', now });
    t += HEAD_TTL_MS - 1000;
    const b = await getHeadSha({ kvs, source, repoKey: REPO_KEY, ref: 'main', now });
    expect([a.fromCache, b.fromCache, b.sha, calls()]).toEqual([false, true, SHA_OLD, 1]);
    t += 2000;
    const c = await getHeadSha({ kvs, source, repoKey: REPO_KEY, ref: 'main', now });
    expect([c.fromCache, c.sha, calls()]).toEqual([false, SHA_NEW, 2]);
  });

  it('caches failures for the same window and rethrows the typed error', async () => {
    const kvs = new FakeKvs();
    const { source, calls } = fakeSource([failing('rate_limited', '2026-11-15T11:00:00.000Z')]);
    await expect(getHeadSha({ kvs, source, repoKey: REPO_KEY, ref: 'main', now })).rejects.toMatchObject({ reason: 'rate_limited' });
    t += 60_000;
    await expect(getHeadSha({ kvs, source, repoKey: REPO_KEY, ref: 'main', now })).rejects.toMatchObject({ reason: 'rate_limited', resetAt: '2026-11-15T11:00:00.000Z' });
    expect(calls()).toBe(1);
  });

  it('a different ref or a shorter manual window bypasses the cache', async () => {
    const kvs = new FakeKvs();
    const { source, calls } = fakeSource([() => SHA_OLD]);
    await getHeadSha({ kvs, source, repoKey: REPO_KEY, ref: 'main', now });
    await getHeadSha({ kvs, source, repoKey: REPO_KEY, ref: 'dev', now });
    t += 61_000;
    await getHeadSha({ kvs, source, repoKey: REPO_KEY, ref: 'dev', now, maxAgeMs: 60_000 });
    expect(calls()).toBe(3);
    expect(kvs.ttls.get(headKey(REPO_KEY))).toBeDefined();
  });
});

describe('getIndexForCheck', () => {
  it('returns a fresh index without any REST call', async () => {
    const kvs = new FakeKvs();
    await seed(kvs, t - 60_000);
    const { source, calls } = fakeSource([() => SHA_NEW]);
    const q: unknown[] = [];
    const r = await getIndexForCheck(deps(kvs, source, q), REPO_KEY, 'main');
    expect(r).toMatchObject({ state: 'ready', stale: false });
    expect(calls()).toBe(0);
    expect(q).toEqual([]);
  });

  it('after 15 minutes checks the head once, and stays fresh when the sha is unchanged', async () => {
    const kvs = new FakeKvs();
    await seed(kvs, t - FRESH_MS - 1000);
    const { source, calls } = fakeSource([() => SHA_OLD]);
    const q: unknown[] = [];
    expect(await getIndexForCheck(deps(kvs, source, q), REPO_KEY, 'main')).toMatchObject({ state: 'ready', stale: false });
    await getIndexForCheck(deps(kvs, source, q), REPO_KEY, 'main');
    expect(calls()).toBe(1);
    expect(q).toEqual([]);
  });

  it('marks the index stale when the branch moved, queues one rebuild and does not requeue while in flight', async () => {
    const kvs = new FakeKvs();
    await seed(kvs, t - FRESH_MS - 1000);
    const { source } = fakeSource([() => SHA_NEW]);
    const q: unknown[] = [];
    const r = await getIndexForCheck(deps(kvs, source, q), REPO_KEY, 'main');
    expect(r).toMatchObject({ state: 'ready', stale: true, headSha: SHA_NEW, reindexQueued: true });
    if (r.state === 'ready') expect(r.index.repo.sha).toBe(SHA_OLD);
    expect(q).toEqual([{ repoKey: REPO_KEY, reason: 'stale' }]);
    expect((await getStatus(kvs, REPO_KEY))?.state).toBe('queued');
    const again = await getIndexForCheck(deps(kvs, source, q), REPO_KEY, 'main');
    expect(again).toMatchObject({ stale: true, reindexQueued: false });
    expect(q).toHaveLength(1);
  });

  it('falls back to the last good index when the REST call is rate limited', async () => {
    const kvs = new FakeKvs();
    await seed(kvs, t - FRESH_MS - 1000);
    const { source } = fakeSource([failing('rate_limited', '2026-11-15T11:00:00.000Z')]);
    const q: unknown[] = [];
    const r = await getIndexForCheck(deps(kvs, source, q), REPO_KEY, 'main');
    expect(r).toMatchObject({ state: 'ready', stale: true, staleReason: 'rate_limited', resetAt: '2026-11-15T11:00:00.000Z', reindexQueued: false });
    expect(q).toEqual([]);
  });

  it('keeps serving the old index when the repo disappears', async () => {
    const kvs = new FakeKvs();
    await seed(kvs, t - FRESH_MS - 1000);
    const { source } = fakeSource([failing('repo_not_found_or_private')]);
    const r = await getIndexForCheck(deps(kvs, source, []), REPO_KEY, 'main');
    expect(r).toMatchObject({ state: 'ready', stale: true, staleReason: 'repo_not_found_or_private' });
  });

  it('without an index it queues a build once and reports indexing', async () => {
    const kvs = new FakeKvs();
    const { source } = fakeSource([() => SHA_NEW]);
    const q: unknown[] = [];
    expect(await getIndexForCheck(deps(kvs, source, q), REPO_KEY, 'main')).toEqual({ state: 'indexing' });
    expect(await getIndexForCheck(deps(kvs, source, q), REPO_KEY, 'main')).toEqual({ state: 'indexing' });
    expect(q).toEqual([{ repoKey: REPO_KEY, reason: 'missing' }]);
  });

  it('without an index and a recent failed build it returns the typed reason, never a verdict', async () => {
    const kvs = new FakeKvs();
    await setStatus(kvs, REPO_KEY, { state: 'error', updatedAt: new Date(t - 60_000).toISOString(), reason: 'repo_not_found_or_private', message: 'nope' });
    const q: unknown[] = [];
    const r = await getIndexForCheck(deps(kvs, fakeSource([() => SHA_NEW]).source, q), REPO_KEY, 'main');
    expect(r).toEqual({ state: 'unavailable', reason: 'repo_not_found_or_private', message: 'nope' });
    expect(q).toEqual([]);
    t += HEAD_TTL_MS + 1000; // after the window it tries again
    expect(await getIndexForCheck(deps(kvs, fakeSource([() => SHA_NEW]).source, q), REPO_KEY, 'main')).toEqual({ state: 'indexing' });
    expect(q).toHaveLength(1);
  });

  it('treats a corrupt shard as missing and rebuilds', async () => {
    const kvs = new FakeKvs();
    await seed(kvs, t - 1000);
    for (const k of [...kvs.data.keys()]) if (k.includes(':routes:')) kvs.data.delete(k);
    const q: unknown[] = [];
    expect(await getIndexForCheck(deps(kvs, fakeSource([() => SHA_OLD]).source, q), REPO_KEY, 'main')).toEqual({ state: 'indexing' });
    expect(q).toHaveLength(1);
  });
});
