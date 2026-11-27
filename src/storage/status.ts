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
  return kvs.get<IndexStatus>(statusKey(repoKey));
}

export async function setStatus(kvs: KvsLike, repoKey: string, status: IndexStatus): Promise<void> {
  await kvs.set(statusKey(repoKey), status);
}

/** A queued or indexing status younger than this blocks another push. */
export const IN_FLIGHT_MS = 6 * 60 * 1000;

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
  await setStatus(kvs, repoKey, { ...previous, state: 'queued', updatedAt: iso, startedAt: iso, queueAttempt });
  try {
    await push();
  } catch (error) {
    try {
      const current = await getStatus(kvs, repoKey);
      if (current?.state === 'queued' && current.queueAttempt === queueAttempt) {
        if (previous) await setStatus(kvs, repoKey, previous);
        else await kvs.delete(statusKey(repoKey));
      }
    } catch {
      console.warn('Could not restore the index status after a failed queue request.');
    }
    throw error;
  }
  return true;
}
