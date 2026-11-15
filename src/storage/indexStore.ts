/**
 * Sharded RepoIndex storage in KVS (PLAN.md 5.1). Each kind is split into values under
 * 190 KiB (the KVS limit is 240 KiB, the plan asks for under 200 KiB). The pointer
 * `idx:{repoKey}:current` is written last, so a reader never sees a half-written index.
 * The index before the previous one is deleted after the flip, so at most two stay.
 */
import type { Coverage, IndexKind, IndexStats, RepoIndex, RepoRef } from '../core/model';
import { INDEX_KINDS, pointerKey, shardKey } from './keys';
import { StorageError } from './kvs';
import type { KvsLike } from './kvs';

export const MAX_SHARD_BYTES = 190 * 1024;
const BATCH = 20;
const MAX_CONFIG_FILES = 2000;

export type ShardCounts = Record<IndexKind, number>;

export interface IndexPointer {
  schema: 'pil.index.ptr.v1';
  repoKey: string;
  repo: RepoRef;
  stats: IndexStats;
  coverage: Record<IndexKind, Coverage>;
  configFiles: string[];
  shards: ShardCounts;
  /** Serialized size of all shards, for the settings page. */
  bytes: number;
  /** The previous good index, kept until the next flip. */
  previous?: { sha: string; shards: ShardCounts };
}

interface Shard {
  schema: 'pil.index.shard.v1';
  sha: string;
  kind: IndexKind;
  n: number;
  items: unknown[];
}

const bytesOf = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

/** Split items into chunks whose serialized shard stays under `limit` bytes. */
export function chunkItems(items: unknown[], overhead: number, limit = MAX_SHARD_BYTES): unknown[][] {
  const chunks: unknown[][] = [];
  let cur: unknown[] = [];
  let size = overhead;
  for (const item of items) {
    const s = bytesOf(item) + 1;
    if (s + overhead > limit) continue; // a single item that cannot fit is dropped; items are tiny (<1 KiB) in practice
    if (size + s > limit && cur.length > 0) {
      chunks.push(cur);
      cur = [];
      size = overhead;
    }
    cur.push(item);
    size += s;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

const emptyCounts = (): ShardCounts => ({ routes: 0, env: 0, cli: 0, config: 0, files: 0, packages: 0 });

export async function readPointer(kvs: KvsLike, repoKey: string): Promise<IndexPointer | undefined> {
  const p = await kvs.get<IndexPointer>(pointerKey(repoKey));
  if (!p || p.schema !== 'pil.index.ptr.v1') return undefined;
  return p;
}

async function batchOrThrow(kvs: KvsLike, op: 'set' | 'delete', items: Array<{ key: string; value?: unknown }>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) {
    const part = items.slice(i, i + BATCH);
    const res = op === 'set' ? await kvs.batchSet(part.map((x) => ({ key: x.key, value: x.value }))) : await kvs.batchDelete(part.map((x) => ({ key: x.key })));
    if (res.failedKeys.length > 0) throw new StorageError('write_failed', `Storage ${op} failed for ${res.failedKeys.length} key(s).`);
  }
}

export interface WriteResult {
  pointer: IndexPointer;
  shardCount: number;
  maxShardBytes: number;
}

export async function writeIndex(kvs: KvsLike, repoKey: string, index: RepoIndex): Promise<WriteResult> {
  const sha = index.repo.sha;
  const prev = await readPointer(kvs, repoKey);

  const shards = emptyCounts();
  const writes: Array<{ key: string; value: Shard }> = [];
  let bytes = 0;
  let maxShard = 0;
  for (const kind of INDEX_KINDS) {
    const items = index[kind] as unknown[];
    const overhead = bytesOf({ schema: 'pil.index.shard.v1', sha, kind, n: 99999, items: [] }) + 8;
    const chunks = chunkItems(items, overhead);
    chunks.forEach((chunk, n) => {
      const value: Shard = { schema: 'pil.index.shard.v1', sha, kind, n, items: chunk };
      const size = bytesOf(value);
      bytes += size;
      maxShard = Math.max(maxShard, size);
      writes.push({ key: shardKey(repoKey, sha, kind, n), value });
    });
    shards[kind] = chunks.length;
  }

  // 1. shards
  await batchOrThrow(kvs, 'set', writes);

  // 2. pointer, last
  const configFiles = index.configFiles.slice(0, MAX_CONFIG_FILES);
  const coverage = { ...index.coverage };
  if (configFiles.length < index.configFiles.length) coverage.config = 'partial';
  const pointer: IndexPointer = {
    schema: 'pil.index.ptr.v1',
    repoKey,
    repo: index.repo,
    stats: index.stats,
    coverage,
    configFiles,
    shards,
    bytes,
  };
  const keepPrevious = prev && prev.repo.sha !== sha ? { sha: prev.repo.sha, shards: prev.shards } : prev?.previous;
  if (keepPrevious) pointer.previous = keepPrevious;
  await kvs.set(pointerKey(repoKey), pointer);

  // 3. cleanup of the index before the previous one (best effort)
  const stale = prev?.previous && prev.previous.sha !== sha && prev.previous.sha !== prev.repo.sha ? prev.previous : undefined;
  if (stale && stale.sha !== keepPrevious?.sha) {
    const dels: Array<{ key: string }> = [];
    for (const kind of INDEX_KINDS) for (let n = 0; n < stale.shards[kind]; n++) dels.push({ key: shardKey(repoKey, stale.sha, kind, n) });
    try {
      await batchOrThrow(kvs, 'delete', dels);
    } catch {
      // Orphaned shards are harmless; they are overwritten if the same sha is indexed again.
    }
  }
  return { pointer, shardCount: writes.length, maxShardBytes: maxShard };
}

// ---------------------------------------------------------------------------
// reads with a small in-memory cache (warm invocations)
// ---------------------------------------------------------------------------

const MAX_CACHE_ENTRIES = 24;
const cache = new Map<string, unknown[]>();

export function clearIndexCache(): void {
  cache.clear();
}

function cacheGet(key: string): unknown[] | undefined {
  const v = cache.get(key);
  if (v) {
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

function cachePut(key: string, items: unknown[]): void {
  cache.set(key, items);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface LoadedIndex {
  index: RepoIndex;
  pointer: IndexPointer;
  /** Kinds whose entries were loaded; the others are empty arrays (their coverage is still set). */
  loaded: IndexKind[];
}

/** Read the pointer and only the requested kinds. Returns undefined when no index exists. */
export async function loadIndex(kvs: KvsLike, repoKey: string, kinds: readonly IndexKind[] = INDEX_KINDS, pointer?: IndexPointer): Promise<LoadedIndex | undefined> {
  const ptr = pointer ?? (await readPointer(kvs, repoKey));
  if (!ptr) return undefined;
  const sha = ptr.repo.sha;
  const data: Record<IndexKind, unknown[]> = { routes: [], env: [], cli: [], config: [], files: [], packages: [] };
  for (const kind of kinds) {
    const ck = `${repoKey}:${sha}:${ptr.repo.indexedAt}:${kind}`;
    const hit = cacheGet(ck);
    if (hit) {
      data[kind] = hit;
      continue;
    }
    const count = ptr.shards[kind];
    const keys = Array.from({ length: count }, (_, n) => shardKey(repoKey, sha, kind, n));
    const items: unknown[] = [];
    for (let i = 0; i < keys.length; i += BATCH) {
      const part = keys.slice(i, i + BATCH);
      const res = await kvs.batchGet<Shard>(part.map((key) => ({ key })));
      if (res.failedKeys.length > 0 || res.successfulKeys.length !== part.length) throw new StorageError('index_corrupt', 'An index shard is missing.');
      const byKey = new Map(res.successfulKeys.map((r) => [r.key, r.value]));
      for (const key of part) {
        const shard = byKey.get(key);
        const n = Number(key.slice(key.lastIndexOf(':') + 1));
        if (!shard || shard.schema !== 'pil.index.shard.v1' || shard.sha !== sha || shard.kind !== kind || shard.n !== n || !Array.isArray(shard.items)) {
          throw new StorageError('index_corrupt', 'An index shard does not match its pointer.');
        }
        items.push(...shard.items);
      }
    }
    cachePut(ck, items);
    data[kind] = items;
  }
  const index = {
    schema: 'pil.index.v1',
    repo: ptr.repo,
    stats: ptr.stats,
    coverage: ptr.coverage,
    routes: data.routes,
    env: data.env,
    cli: data.cli,
    config: data.config,
    files: data.files,
    packages: data.packages,
    configFiles: ptr.configFiles,
  } as RepoIndex;
  return { index, pointer: ptr, loaded: [...kinds] };
}
