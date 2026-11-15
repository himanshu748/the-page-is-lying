import { beforeEach, describe, expect, it } from 'vitest';
import { buildRepoIndex } from '../../src/core/index/build';
import type { RepoFile } from '../../src/core/index/types';
import type { RepoIndex } from '../../src/core/model';
import { MAX_SHARD_BYTES, chunkItems, clearIndexCache, loadIndex, readPointer, writeIndex } from '../../src/storage/indexStore';
import { StorageError } from '../../src/storage/kvs';
import { escapeKeySegment, pointerKey, repoKeyOf, shardKey } from '../../src/storage/keys';
import { loadFixture } from '../repo/helpers';
import { FakeKvs } from './fakeKvs';

const REPO_KEY = repoKeyOf('github', 'o/r', 'main');
const ctx = (sha: string, files: RepoFile[]) => ({
  repo: { provider: 'github' as const, fullName: 'o/r', ref: 'main', sha, indexedAt: '2026-11-15T10:00:00.000Z' },
  stats: { filesIndexed: files.length, filesSkipped: 0, truncated: false },
  treePaths: files.map((f) => f.path),
});
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const SHA3 = '3'.repeat(40);

function demo(sha = SHA1): RepoIndex {
  const files = loadFixture('payments-api-mini');
  return buildRepoIndex(files, ctx(sha, files));
}

function synthetic(n: number): RepoIndex {
  const files: RepoFile[] = [];
  for (let i = 0; i < n; i++) {
    files.push({
      path: `services/svc-${i}/src/handlers/very-long-directory-name-for-padding/route-${i}.ts`,
      text: `import express from 'express';\nconst app = express();\napp.get('/v1/resource-${i}/:id/with/a/fairly/long/path/segment', h);\nconst k = process.env.SERVICE_${i}_SECRET_KEY_NAME;\n`,
    });
  }
  return buildRepoIndex(files, ctx(SHA1, files));
}

beforeEach(() => clearIndexCache());

describe('keys', () => {
  it('escapes everything outside [A-Za-z0-9._-] with # and bounds length', () => {
    expect(escapeKeySegment('gh:o/r@main')).toBe('gh#3Ao#2Fr#40main');
    expect(escapeKeySegment('é')).toBe('#C3#A9');
    expect(escapeKeySegment('x'.repeat(1000))).toMatch(/^h#[0-9a-f]{40}$/);
    expect(repoKeyOf('bitbucket', 'ws/rp', '')).toBe('bb#3Aws#2Frp#40HEAD');
    const worst = shardKey(escapeKeySegment('x/'.repeat(500)), SHA1, 'packages', 99999);
    expect(worst.length).toBeLessThan(500);
    expect(worst).toMatch(/^[A-Za-z0-9:._#-]+$/);
  });
});

describe('writeIndex / loadIndex', () => {
  it('round-trips the demo index', async () => {
    const kvs = new FakeKvs();
    const index = demo();
    await writeIndex(kvs, REPO_KEY, index);
    const loaded = await loadIndex(kvs, REPO_KEY);
    expect(loaded?.index).toEqual(index);
    expect(loaded?.loaded).toHaveLength(6);
  });

  it('writes shards first and the pointer last, then nothing else', async () => {
    const kvs = new FakeKvs();
    await writeIndex(kvs, REPO_KEY, demo());
    const order = kvs.writeOrder();
    expect(order.at(-1)).toBe(pointerKey(REPO_KEY));
    expect(order.slice(0, -1).every((k) => k.startsWith(`idx:${REPO_KEY}:${SHA1}:`))).toBe(true);
    expect(order.filter((k) => k === pointerKey(REPO_KEY))).toHaveLength(1);
    // a reader sees no index until the pointer exists
    const partial = new FakeKvs();
    partial.failBatchSet = true;
    await expect(writeIndex(partial, REPO_KEY, demo())).rejects.toBeInstanceOf(StorageError);
    expect(await readPointer(partial, REPO_KEY)).toBeUndefined();
  });

  it('keeps every shard under 200 KiB for a synthetic 5,000 file repo and round-trips it', async () => {
    const kvs = new FakeKvs();
    const index = synthetic(5000);
    expect(index.routes).toHaveLength(5000);
    const res = await writeIndex(kvs, REPO_KEY, index);
    expect(res.shardCount).toBeGreaterThan(6);
    expect(res.maxShardBytes).toBeLessThanOrEqual(200 * 1024);
    for (const [key, value] of kvs.data) {
      if (key.startsWith('idx:')) expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(200 * 1024);
    }
    const loaded = await loadIndex(kvs, REPO_KEY);
    expect(loaded?.index.routes).toEqual(index.routes);
    expect(loaded?.index.env).toEqual(index.env);
    expect(loaded?.index.files).toEqual(index.files);
  });

  it('chunkItems respects the limit and keeps order', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ i, pad: 'x'.repeat(300) }));
    const chunks = chunkItems(items, 200, 10_000);
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.flat()).toEqual(items);
    for (const c of chunks) expect(Buffer.byteLength(JSON.stringify(c))).toBeLessThan(10_000);
    expect(MAX_SHARD_BYTES).toBeLessThan(200 * 1024);
  });

  it('loads only the requested kinds', async () => {
    const kvs = new FakeKvs();
    await writeIndex(kvs, REPO_KEY, demo());
    kvs.ops.length = 0;
    const loaded = await loadIndex(kvs, REPO_KEY, ['env']);
    expect(loaded?.index.env.length).toBeGreaterThan(0);
    expect(loaded?.index.routes).toEqual([]);
    expect(loaded?.index.coverage.routes).toBe('complete');
    const read = kvs.ops.filter((o) => o.op === 'batchGet').flatMap((o) => o.keys);
    expect(read.every((k) => k.includes(':env:'))).toBe(true);
  });

  it('serves repeat reads from the warm cache', async () => {
    const kvs = new FakeKvs();
    await writeIndex(kvs, REPO_KEY, demo());
    await loadIndex(kvs, REPO_KEY, ['routes']);
    kvs.ops.length = 0;
    const again = await loadIndex(kvs, REPO_KEY, ['routes']);
    expect(again?.index.routes.length).toBeGreaterThan(0);
    expect(kvs.ops.filter((o) => o.op === 'batchGet')).toHaveLength(0);
  });

  it('returns undefined without a pointer and throws index_corrupt for a missing or foreign shard', async () => {
    const kvs = new FakeKvs();
    expect(await loadIndex(kvs, REPO_KEY)).toBeUndefined();
    await writeIndex(kvs, REPO_KEY, demo());
    clearIndexCache();
    kvs.data.delete(shardKey(REPO_KEY, SHA1, 'routes', 0));
    await expect(loadIndex(kvs, REPO_KEY)).rejects.toMatchObject({ code: 'index_corrupt' });
    await writeIndex(kvs, REPO_KEY, demo());
    clearIndexCache();
    const key = shardKey(REPO_KEY, SHA1, 'routes', 0);
    kvs.data.set(key, { ...(kvs.data.get(key) as object), sha: SHA2 });
    await expect(loadIndex(kvs, REPO_KEY)).rejects.toMatchObject({ code: 'index_corrupt' });
  });

  it('keeps the previous index and deletes the one before it after the pointer flip', async () => {
    const kvs = new FakeKvs();
    await writeIndex(kvs, REPO_KEY, demo(SHA1));
    await writeIndex(kvs, REPO_KEY, demo(SHA2));
    const has = (sha: string) => [...kvs.data.keys()].some((k) => k.startsWith(`idx:${REPO_KEY}:${sha}:`));
    expect(has(SHA1) && has(SHA2)).toBe(true);
    expect((await readPointer(kvs, REPO_KEY))?.previous?.sha).toBe(SHA1);
    kvs.ops.length = 0;
    await writeIndex(kvs, REPO_KEY, demo(SHA3));
    expect(has(SHA1)).toBe(false);
    expect(has(SHA2) && has(SHA3)).toBe(true);
    const lastSet = kvs.ops.map((o) => o.op).lastIndexOf('set');
    const firstDelete = kvs.ops.findIndex((o) => o.op === 'batchDelete');
    expect(firstDelete).toBeGreaterThan(lastSet); // cleanup only after the flip
    // re-indexing the same sha keeps the chain intact
    await writeIndex(kvs, REPO_KEY, demo(SHA3));
    expect((await readPointer(kvs, REPO_KEY))?.previous?.sha).toBe(SHA2);
    expect(has(SHA2)).toBe(true);
  });
});
