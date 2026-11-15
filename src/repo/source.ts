/**
 * RepoSource: the interface every repository adapter implements (PLAN.md section 8),
 * plus snapshot limits, counters and the typed error callers turn into Unknown.
 */
import type { ReasonCode, RepoProvider } from '../core/model';
import type { RepoFile } from '../core/index/types';

export type { RepoFile };

export interface SnapshotLimits {
  /** Compressed tarball cap. Default 25 MB. */
  maxCompressedBytes: number;
  /** Total uncompressed cap, a guard against decompression bombs. Default 120 MB. */
  maxUncompressedBytes: number;
  /** Text files handed to the index builders. Default 5,000. */
  maxFiles: number;
  /** Per-file cap. Default 1 MB. */
  maxFileBytes: number;
  /** Maximum paths kept for the file tree. */
  maxTreePaths: number;
  /** Directory names whose files are never read (still listed in the tree). */
  skipDirs: ReadonlySet<string>;
}

export const DEFAULT_LIMITS: SnapshotLimits = {
  maxCompressedBytes: 25 * 1024 * 1024,
  maxUncompressedBytes: 120 * 1024 * 1024,
  maxFiles: 5000,
  maxFileBytes: 1024 * 1024,
  maxTreePaths: 20000,
  skipDirs: new Set(['node_modules', 'vendor', 'dist', 'build', '.git', 'coverage']),
};

/** Filled in while a snapshot is iterated. */
export interface SnapshotCounters {
  /** Text files yielded to the builders. */
  filesIndexed: number;
  /** Files that were seen but not read: skip dirs, minified, lockfiles, too large, binary, over the file limit. */
  filesSkipped: number;
  skipped: { dir: number; minified: number; lockfile: number; tooLarge: number; binary: number; overLimit: number };
  /** True when the file limit or the tree cap cut the snapshot short. */
  truncated: boolean;
  /** Every path seen (outside skip dirs first, then skip-dir paths while room remains), capped at maxTreePaths. */
  paths: string[];
  /** Set when the archive could not be fully read. The adapter turns it into a RepoError. */
  problem?: 'tarball_too_large' | 'invalid_archive';
}

export function createCounters(): SnapshotCounters {
  return {
    filesIndexed: 0,
    filesSkipped: 0,
    skipped: { dir: 0, minified: 0, lockfile: 0, tooLarge: 0, binary: 0, overLimit: 0 },
    truncated: false,
    paths: [],
  };
}

export interface ResolvedRef {
  sha: string;
  /** The ref that was asked for, or "HEAD" for the default branch. */
  ref: string;
}

export interface RepoSource {
  readonly provider: RepoProvider;
  /** `owner/repo` or `workspace/repo`. */
  readonly fullName: string;
  /** One REST call. Callers cache it (src/storage/freshness.ts). */
  resolveRef(ref?: string): Promise<ResolvedRef>;
  /** Text files of the snapshot. Throws RepoError when the download fails or the archive is unusable. */
  snapshot(sha: string, limits?: SnapshotLimits, counters?: SnapshotCounters): AsyncIterable<RepoFile>;
  permalink(sha: string, path: string, line: number): string;
}

export type RepoErrorReason =
  | 'repo_not_found_or_private'
  | 'rate_limited'
  | 'tarball_too_large'
  | 'invalid_repo_url'
  | 'ref_not_found'
  | 'upstream_error';

/**
 * Every adapter failure is a RepoError. Callers turn it into Unknown with `toReasonCode`,
 * never into Verified. The message never contains tokens, URLs with credentials or repo text.
 */
export class RepoError extends Error {
  readonly reason: RepoErrorReason;
  /** ISO 8601 time when a rate limit resets, if known. */
  readonly resetAt?: string;
  constructor(reason: RepoErrorReason, message: string, resetAt?: string) {
    super(message);
    this.name = 'RepoError';
    this.reason = reason;
    if (resetAt !== undefined) this.resetAt = resetAt;
  }
}

/** Reason codes from src/core/model.ts. Reasons without their own code map to `index_missing`. */
export function toReasonCode(reason: RepoErrorReason): ReasonCode {
  switch (reason) {
    case 'repo_not_found_or_private':
    case 'rate_limited':
    case 'tarball_too_large':
      return reason;
    default:
      return 'index_missing';
  }
}

export function isRepoError(e: unknown): e is RepoError {
  return e instanceof RepoError;
}

/** Minimal fetch shape both Forge's `fetch` and test fakes satisfy. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; redirect?: 'follow' | 'manual' | 'error' }) => Promise<FetchResponse>;

/** Encode each path segment, keep the slashes. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export const SHA_RE = /^[0-9a-f]{40}$/;

const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;
export function validateRef(ref: string): boolean {
  return REF_RE.test(ref) && !ref.includes('..') && !ref.startsWith('-') && !ref.startsWith('/') && !ref.endsWith('/') && !ref.includes('//');
}

/** A token goes into an Authorization header: printable ASCII, no spaces. */
export function validateToken(token: string): boolean {
  return /^[\x21-\x7e]{8,512}$/.test(token);
}

/** Seconds from a Retry-After header, or undefined. */
export function retryAfterIso(value: string | null, now: () => number): string | undefined {
  if (value === null) return undefined;
  const secs = Number(value);
  if (!Number.isFinite(secs) || secs < 0) return undefined;
  return new Date(now() + Math.min(secs, 86_400) * 1000).toISOString();
}
