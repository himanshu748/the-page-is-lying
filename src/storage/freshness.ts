/**
 * Freshness and the stale fallback (PLAN.md 5.1, 8).
 *
 * - `getHeadSha` makes at most one REST call per 10 minutes per repo (failures are cached too).
 * - `getIndexForCheck` is what the check service calls: it returns the current index, marks it
 *   stale when the branch moved or the REST call failed, queues a rebuild, and returns a typed
 *   reason (never a verdict) when nothing usable exists.
 */
import type { IndexKind, ReasonCode, RepoIndex } from '../core/model';
import { RepoError, isRepoError, toReasonCode } from '../repo/source';
import type { RepoSource } from '../repo/source';
import { INDEX_KINDS, headKey } from './keys';
import type { KvsLike } from './kvs';
import { StorageError } from './kvs';
import { loadIndex, readPointer } from './indexStore';
import type { IndexPointer } from './indexStore';
import { getStatus, isInFlight, setStatus } from './status';

export const HEAD_TTL_MS = 10 * 60 * 1000;
export const FRESH_MS = 15 * 60 * 1000;
export const MANUAL_HEAD_TTL_MS = 60 * 1000;

interface HeadEntry {
  ref: string;
  checkedAt: number;
  sha?: string;
  error?: { reason: RepoError['reason']; message: string; resetAt?: string };
}

export interface HeadResult {
  sha: string;
  ref: string;
  checkedAt: number;
  fromCache: boolean;
}

export async function getHeadSha(args: {
  kvs: KvsLike;
  source: RepoSource;
  repoKey: string;
  ref?: string | undefined;
  now: () => number;
  /** Cache window. Defaults to 10 minutes; a manual "Index now" uses 1 minute. */
  maxAgeMs?: number;
}): Promise<HeadResult> {
  const { kvs, source, repoKey, now } = args;
  const maxAge = args.maxAgeMs ?? HEAD_TTL_MS;
  const t = now();
  const cached = await kvs.get<HeadEntry>(headKey(repoKey));
  if (cached && t - cached.checkedAt < maxAge && cached.ref === (args.ref ?? 'HEAD')) {
    if (cached.sha) return { sha: cached.sha, ref: cached.ref, checkedAt: cached.checkedAt, fromCache: true };
    if (cached.error) throw new RepoError(cached.error.reason, cached.error.message, cached.error.resetAt);
  }
  try {
    const r = await source.resolveRef(args.ref);
    await kvs.set(headKey(repoKey), { ref: r.ref, checkedAt: t, sha: r.sha } satisfies HeadEntry, { ttl: { value: 1, unit: 'DAYS' } });
    return { sha: r.sha, ref: r.ref, checkedAt: t, fromCache: false };
  } catch (e) {
    if (isRepoError(e)) {
      const entry: HeadEntry = { ref: args.ref ?? 'HEAD', checkedAt: t, error: { reason: e.reason, message: e.message, ...(e.resetAt !== undefined ? { resetAt: e.resetAt } : {}) } };
      await kvs.set(headKey(repoKey), entry, { ttl: { value: 1, unit: 'HOURS' } });
    }
    throw e;
  }
}

export type IndexLookup =
  | {
      state: 'ready';
      index: RepoIndex;
      pointer: IndexPointer;
      /** True only when a newer commit was seen on the branch. */
      stale: boolean;
      /** Set when the check for a newer commit failed (rate limit, repository unreachable). `stale` is then false: the index could not be compared, which is not the same as the repository having changed. */
      staleReason?: ReasonCode;
      /** The newer commit that was seen, when stale. */
      headSha?: string;
      resetAt?: string;
      reindexQueued: boolean;
    }
  | { state: 'indexing' }
  | { state: 'unavailable'; reason: ReasonCode; message: string; resetAt?: string };

export interface FreshnessDeps {
  kvs: KvsLike;
  /** Pushes a job to the `repo-index` queue. */
  enqueue: (body: { repoKey: string; reason: 'missing' | 'stale' | 'manual' }) => Promise<void>;
  /** Built lazily so no network client is needed on the fast path. */
  getSource: () => Promise<RepoSource>;
  now: () => number;
}

async function queueIndex(deps: FreshnessDeps, repoKey: string, reason: 'missing' | 'stale'): Promise<boolean> {
  const status = await getStatus(deps.kvs, repoKey);
  if (isInFlight(status, deps.now())) return false;
  const iso = new Date(deps.now()).toISOString();
  await setStatus(deps.kvs, repoKey, { ...(status ?? {}), state: 'queued', updatedAt: iso, startedAt: iso });
  await deps.enqueue({ repoKey, reason });
  return true;
}

export async function getIndexForCheck(deps: FreshnessDeps, repoKey: string, ref: string | undefined, kinds: readonly IndexKind[] = INDEX_KINDS): Promise<IndexLookup> {
  const pointer = await readPointer(deps.kvs, repoKey);
  if (!pointer) {
    const status = await getStatus(deps.kvs, repoKey);
    if (isInFlight(status, deps.now())) return { state: 'indexing' };
    if (status?.state === 'error' && status.reason) {
      const age = deps.now() - Date.parse(status.updatedAt);
      if (Number.isFinite(age) && age < HEAD_TTL_MS) {
        return { state: 'unavailable', reason: status.reason, message: status.message ?? 'The last attempt to index the repository failed.', ...(status.resetAt !== undefined ? { resetAt: status.resetAt } : {}) };
      }
    }
    await queueIndex(deps, repoKey, 'missing');
    return { state: 'indexing' };
  }

  let loaded;
  try {
    loaded = await loadIndex(deps.kvs, repoKey, kinds, pointer);
  } catch (e) {
    if (e instanceof StorageError && e.code === 'index_corrupt') {
      await queueIndex(deps, repoKey, 'missing');
      return { state: 'indexing' };
    }
    throw e;
  }
  if (!loaded) return { state: 'indexing' };
  const base = { index: loaded.index, pointer };

  const age = deps.now() - Date.parse(pointer.repo.indexedAt);
  if (Number.isFinite(age) && age < FRESH_MS) return { state: 'ready', ...base, stale: false, reindexQueued: false };

  try {
    const source = await deps.getSource();
    const head = await getHeadSha({ kvs: deps.kvs, source, repoKey, ref, now: deps.now });
    if (head.sha === pointer.repo.sha) return { state: 'ready', ...base, stale: false, reindexQueued: false };
    const queued = await queueIndex(deps, repoKey, 'stale');
    return { state: 'ready', ...base, stale: true, headSha: head.sha, reindexQueued: queued };
  } catch (e) {
    if (isRepoError(e)) {
      // The refresh check failed, so nothing says the branch moved: the index is not reported as stale.
      return { state: 'ready', ...base, stale: false, staleReason: toReasonCode(e.reason), ...(e.resetAt !== undefined ? { resetAt: e.resetAt } : {}), reindexQueued: false };
    }
    throw e;
  }
}
