/**
 * The index job behind the `repo-index` queue consumer (PLAN.md 5.1). Kept free of Forge
 * imports so tests can run it with fakes; `indexRepo.ts` binds it to Forge.
 *
 * The event body is only a hint (`repoKey`, `reason`). The repository, ref and token always
 * come from the validated site settings, never from the event, so a forged event cannot point
 * the consumer at another repository.
 *
 * It never throws for expected failures: a RepoError becomes a status record (shown on the
 * settings page) and the last good index stays in place for the stale fallback.
 */
import { createIndexBuilder } from '../core/index/build';
import type { ReasonCode } from '../core/model';
import { createRepoSource, isRepoError, parseRepoUrl, toReasonCode } from '../repo';
import type { FetchFn } from '../repo';
import { createCounters, DEFAULT_LIMITS } from '../repo/source';
import type { RepoSource, SnapshotLimits } from '../repo/source';
import { MANUAL_HEAD_TTL_MS, getHeadSha } from '../storage/freshness';
import { readPointer, writeIndex } from '../storage/indexStore';
import { repoKeyOf } from '../storage/keys';
import type { KvsLike } from '../storage/kvs';
import { getSettings, readTokenForFetch } from '../storage/settings';
import { IN_FLIGHT_MS, getStatus, setStatus } from '../storage/status';

export interface IndexRepoEvent {
  body?: { repoKey?: string; reason?: 'missing' | 'stale' | 'manual' };
}

export interface IndexJobDeps {
  kvs: KvsLike;
  fetch: FetchFn;
  now: () => number;
  limits?: SnapshotLimits;
  /** Test hook: use this source instead of building one from settings. */
  source?: RepoSource;
}

export type IndexJobResult =
  | { outcome: 'indexed'; sha: string; shards: number; filesIndexed: number; filesSkipped: number }
  | { outcome: 'unchanged'; sha: string }
  | { outcome: 'skipped'; why: 'no_settings' | 'in_progress' | 'repo_changed' }
  | { outcome: 'error'; reason: ReasonCode; resetAt?: string };

export async function runIndexJob(deps: IndexJobDeps, event: IndexRepoEvent = {}): Promise<IndexJobResult> {
  const { kvs, now } = deps;
  const iso = (): string => new Date(now()).toISOString();
  const settings = await getSettings(kvs);
  if (!settings) return { outcome: 'skipped', why: 'no_settings' };

  let coords;
  try {
    coords = parseRepoUrl(settings.repoUrl);
  } catch {
    return { outcome: 'skipped', why: 'no_settings' };
  }
  const fullName = `${coords.owner}/${coords.repo}`;
  const refName = settings.ref ?? 'HEAD';
  const repoKey = repoKeyOf(coords.provider, fullName, refName);
  const reason = event.body?.reason ?? 'missing';
  if (event.body?.repoKey !== undefined && event.body.repoKey !== repoKey) return { outcome: 'skipped', why: 'repo_changed' };

  const prevStatus = await getStatus(kvs, repoKey);
  if (prevStatus?.state === 'indexing' && now() - Date.parse(prevStatus.startedAt ?? prevStatus.updatedAt) < IN_FLIGHT_MS) {
    return { outcome: 'skipped', why: 'in_progress' };
  }
  const startedAt = iso();
  const lastGood = await readPointer(kvs, repoKey);
  await setStatus(kvs, repoKey, { state: 'indexing', updatedAt: startedAt, startedAt, ...(lastGood ? { sha: lastGood.repo.sha } : {}) });

  try {
    const token = await readTokenForFetch(kvs, coords.provider);
    const source =
      deps.source ?? createRepoSource({ repoUrl: settings.repoUrl, fetch: deps.fetch, now, archiveFallback: true, ...(token !== undefined ? { token } : {}) });
    const head = await getHeadSha({
      kvs,
      source,
      repoKey,
      ref: settings.ref,
      now,
      retryCachedError: true,
      ...(reason === 'manual' ? { maxAgeMs: MANUAL_HEAD_TTL_MS } : {}),
    });
    if (lastGood && lastGood.repo.sha === head.sha && reason !== 'manual') {
      await setStatus(kvs, repoKey, { state: 'ok', updatedAt: iso(), sha: head.sha, filesIndexed: lastGood.stats.filesIndexed, filesSkipped: lastGood.stats.filesSkipped });
      return { outcome: 'unchanged', sha: head.sha };
    }

    const counters = createCounters();
    const builder = createIndexBuilder();
    for await (const file of source.snapshot(head.sha, deps.limits ?? DEFAULT_LIMITS, counters)) builder.addFile(file);
    const index = builder.finish({
      repo: { provider: source.provider, fullName: source.fullName, ref: head.ref, sha: head.sha, indexedAt: iso() },
      stats: { filesIndexed: counters.filesIndexed, filesSkipped: counters.filesSkipped, truncated: counters.truncated },
      treePaths: counters.paths,
    });
    const written = await writeIndex(kvs, repoKey, index);
    await setStatus(kvs, repoKey, {
      state: 'ok',
      updatedAt: iso(),
      sha: head.sha,
      filesIndexed: counters.filesIndexed,
      filesSkipped: counters.filesSkipped,
    });
    return { outcome: 'indexed', sha: head.sha, shards: written.shardCount, filesIndexed: counters.filesIndexed, filesSkipped: counters.filesSkipped };
  } catch (e) {
    const rc: ReasonCode = isRepoError(e) ? toReasonCode(e.reason) : 'index_missing';
    const resetAt = isRepoError(e) ? e.resetAt : undefined;
    // Messages from RepoError are written to be safe to show. Anything else gets a generic text.
    const message = isRepoError(e) ? e.message : 'Indexing failed.';
    await setStatus(kvs, repoKey, {
      state: 'error',
      updatedAt: iso(),
      reason: rc,
      message,
      ...(resetAt !== undefined ? { resetAt } : {}),
      ...(lastGood ? { sha: lastGood.repo.sha } : {}),
    });
    return { outcome: 'error', reason: rc, ...(resetAt !== undefined ? { resetAt } : {}) };
  }
}
