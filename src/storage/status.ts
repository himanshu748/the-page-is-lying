/** Index status for the settings page and for de-duplicating queue pushes. */
import { randomUUID } from 'node:crypto';
import type { ReasonCode } from '../core/model';
import { statusKey } from './keys';
import type { KvsLike } from './kvs';

export interface IndexStatus {
  state: 'queued' | 'indexing' | 'ok' | 'error';
  /** ISO 8601. */
  updatedAt: string;
  startedAt?: string;
  queueAttempt?: string;
  previousStatus?: IndexStatus;
  /** Commit of the last good index. */
  sha?: string;
  filesIndexed?: number;
  filesSkipped?: number;
  /** Set when state is "error". */
  reason?: ReasonCode;
  resetAt?: string;
  message?: string;
}

export async function getStatus(kvs: KvsLike, repoKey: string): Promise<IndexStatus | undefined> {
  const status = await kvs.get<IndexStatus>(statusKey(repoKey));
  if (status?.state === 'queued' && status.queueAttempt) {
    const pending = await kvs.get<boolean>(attemptKey(repoKey, status.queueAttempt));
    if (!pending) return status.previousStatus;
  }
  return status;
}

export async function setStatus(kvs: KvsLike, repoKey: string, status: IndexStatus): Promise<void> {
  await kvs.set(statusKey(repoKey), status);
}

/** A queued or indexing status younger than this blocks another push. */
export const IN_FLIGHT_MS = 6 * 60 * 1000;

const attemptKey = (repoKey: string, attempt: string): string => `queue:${repoKey}:${attempt}`;

export function isInFlight(status: IndexStatus | undefined, now: number): boolean {
  if (!status || (status.state !== 'queued' && status.state !== 'indexing')) return false;
  const t = Date.parse(status.startedAt ?? status.updatedAt);
  return Number.isFinite(t) && now - t < IN_FLIGHT_MS;
}

/** Mark the job before pushing it so a fast consumer can advance the status. */
export async function queueIndexJob(kvs: KvsLike, repoKey: string, now: number, push: () => Promise<void>): Promise<boolean> {
  const previous = await getStatus(kvs, repoKey);
  if (isInFlight(previous, now)) return false;
  const iso = new Date(now).toISOString();
  const queueAttempt = randomUUID();
  const key = attemptKey(repoKey, queueAttempt);
  const terminal = previous?.state === 'ok' || previous?.state === 'error' ? previous : previous?.previousStatus;
  await kvs.set(key, true, { ttl: { value: IN_FLIGHT_MS / 1000, unit: 'SECONDS' } });
  try {
    await setStatus(kvs, repoKey, {
      ...terminal, state: 'queued', updatedAt: iso, startedAt: iso, queueAttempt,
      ...(terminal ? { previousStatus: terminal } : {}),
    });
    await push();
  } catch (error) {
    try {
      // The consumer owns the index status. Remove only this dispatch marker.
      await kvs.delete(key);
    } catch {
      console.warn('Could not clear the failed index queue marker. It will expire.');
    }
    throw error;
  }
  return true;
}
