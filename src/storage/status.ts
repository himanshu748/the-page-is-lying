/** Index status for the settings page and for de-duplicating queue pushes. */
import type { ReasonCode } from '../core/model';
import { statusKey } from './keys';
import type { KvsLike } from './kvs';

export interface IndexStatus {
  state: 'queued' | 'indexing' | 'ok' | 'error';
  /** ISO 8601. */
  updatedAt: string;
  startedAt?: string;
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
