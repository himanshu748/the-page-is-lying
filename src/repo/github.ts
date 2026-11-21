/**
 * GitHub adapter: one REST call resolves a ref to a commit SHA, the code snapshot is one
 * tarball from codeload.github.com (PLAN.md section 8). Hosts are fixed here; nothing from
 * the repo or the page can change them.
 */
import { archiveCommitId, iterateTarGz } from './tar';
import {
  DEFAULT_LIMITS,
  RepoError,
  SHA_RE,
  createCounters,
  encodePath,
  retryAfterIso,
  validateRef,
  validateToken,
} from './source';
import type { FetchFn, FetchResponse, RepoFile, RepoSource, ResolvedRef, SnapshotCounters, SnapshotLimits } from './source';

export const GITHUB_API_HOST = 'api.github.com';
export const GITHUB_CODELOAD_HOST = 'codeload.github.com';

export const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
export const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export interface GitHubSourceOptions {
  owner: string;
  repo: string;
  /** Optional read-only token. Only ever sent to api.github.com and codeload.github.com. */
  token?: string;
  fetch: FetchFn;
  now?: () => number;
  /**
   * When the REST API refuses the commit lookup because of its rate limit, read the commit id from the
   * archive on codeload.github.com instead (see `resolveRef`). Off by default: only the index job turns it
   * on, so a page view never downloads an archive.
   */
  archiveFallback?: boolean;
}

export class GitHubSource implements RepoSource {
  readonly provider = 'github' as const;
  readonly fullName: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string | undefined;
  private readonly doFetch: FetchFn;
  private readonly now: () => number;
  private readonly archiveFallback: boolean;
  /** Archive downloaded by the fallback in `resolveRef`, reused once by `snapshot` for the same commit. */
  private prefetched: { sha: string; archive: Uint8Array } | undefined;

  constructor(opts: GitHubSourceOptions) {
    if (!GITHUB_OWNER_RE.test(opts.owner) || !GITHUB_REPO_RE.test(opts.repo) || opts.repo === '.' || opts.repo === '..') {
      throw new RepoError('invalid_repo_url', 'Invalid GitHub owner or repository name.');
    }
    if (opts.token !== undefined && !validateToken(opts.token)) throw new RepoError('invalid_repo_url', 'The stored token has an invalid format.');
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.token = opts.token;
    this.doFetch = opts.fetch;
    this.now = opts.now ?? Date.now;
    this.archiveFallback = opts.archiveFallback ?? false;
    this.fullName = `${opts.owner}/${opts.repo}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'the-page-is-lying', ...extra };
    if (this.token !== undefined) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async get(url: string, headers: Record<string, string>): Promise<FetchResponse> {
    try {
      return await this.doFetch(url, { method: 'GET', headers });
    } catch {
      // Never include the error text: it can echo request details.
      throw new RepoError('upstream_error', 'Could not reach GitHub.');
    }
  }

  async resolveRef(ref?: string): Promise<ResolvedRef> {
    const name = ref === undefined || ref === '' ? 'HEAD' : ref;
    if (name !== 'HEAD' && !validateRef(name)) throw new RepoError('ref_not_found', 'The branch or tag name is not valid.');
    const url = `https://${GITHUB_API_HOST}/repos/${this.owner}/${this.repo}/commits/${encodePath(name)}`;
    const res = await this.get(url, this.headers({ Accept: 'application/vnd.github.sha', 'X-GitHub-Api-Version': '2022-11-28' }));
    if (!res.ok) {
      const error = await this.mapError(res, 'api');
      if (error.reason === 'rate_limited' && this.archiveFallback) {
        const sha = await this.resolveFromArchive(name);
        if (sha !== undefined) return { sha, ref: name };
      }
      throw error;
    }
    const sha = (await res.text()).trim();
    if (!SHA_RE.test(sha)) throw new RepoError('upstream_error', 'GitHub returned an unexpected commit id.');
    return { sha, ref: name };
  }

  /**
   * The REST API allows 60 unauthenticated requests an hour for each address, and Forge apps share
   * addresses. codeload.github.com is not counted against that limit, and its archive names the commit
   * it was made from, so the ref can be resolved from the archive that indexing needs anyway.
   * Returns undefined when that does not work; the caller then reports the rate limit.
   */
  private async resolveFromArchive(name: string): Promise<string | undefined> {
    try {
      const url = `https://${GITHUB_CODELOAD_HOST}/${this.owner}/${this.repo}/tar.gz/${encodePath(name)}`;
      const res = await this.get(url, this.headers());
      if (!res.ok) return undefined;
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > DEFAULT_LIMITS.maxCompressedBytes) return undefined;
      const archive = new Uint8Array(await res.arrayBuffer());
      if (archive.byteLength > DEFAULT_LIMITS.maxCompressedBytes) return undefined;
      const sha = archiveCommitId(archive);
      if (sha === undefined) return undefined;
      this.prefetched = { sha, archive };
      return sha;
    } catch {
      return undefined;
    }
  }

  async *snapshot(sha: string, limits: SnapshotLimits = DEFAULT_LIMITS, counters: SnapshotCounters = createCounters()): AsyncGenerator<RepoFile, void, undefined> {
    if (!SHA_RE.test(sha)) throw new RepoError('ref_not_found', 'A full 40 character commit id is required.');
    const buf = this.takePrefetched(sha) ?? (await this.download(sha, limits));
    if (buf.byteLength > limits.maxCompressedBytes) throw new RepoError('tarball_too_large', 'The repository archive is larger than the allowed size.');
    yield* iterateTarGz(buf, limits, counters);
    if (counters.problem === 'tarball_too_large') throw new RepoError('tarball_too_large', 'The repository is larger than the allowed unpacked size.');
    if (counters.problem === 'invalid_archive') throw new RepoError('upstream_error', 'The repository archive could not be read.');
  }

  private takePrefetched(sha: string): Uint8Array | undefined {
    const kept = this.prefetched;
    this.prefetched = undefined;
    return kept?.sha === sha ? kept.archive : undefined;
  }

  private async download(sha: string, limits: SnapshotLimits): Promise<Uint8Array> {
    const url = `https://${GITHUB_CODELOAD_HOST}/${this.owner}/${this.repo}/tar.gz/${sha}`;
    const res = await this.get(url, this.headers());
    if (!res.ok) throw await this.mapError(res, 'codeload');
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limits.maxCompressedBytes) throw new RepoError('tarball_too_large', 'The repository archive is larger than the allowed size.');
    return new Uint8Array(await res.arrayBuffer());
  }

  permalink(sha: string, path: string, line: number): string {
    return `https://github.com/${this.owner}/${this.repo}/blob/${sha}/${encodePath(path)}#L${Math.max(1, Math.floor(line))}`;
  }

  private async mapError(res: FetchResponse, where: 'api' | 'codeload'): Promise<RepoError> {
    const s = res.status;
    if (s === 404) return new RepoError('repo_not_found_or_private', 'The repository was not found, or it is private.');
    if (s === 401) return new RepoError('repo_not_found_or_private', 'GitHub rejected the access token, or the repository is private.');
    if (s === 422) return new RepoError('ref_not_found', 'The branch, tag or commit was not found.');
    if (s === 403 || s === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const retry = res.headers.get('retry-after');
      const body = await res.text().then((t) => t.slice(0, 500), () => '');
      const limited = s === 429 || remaining === '0' || retry !== null || /rate limit|abuse/i.test(body);
      if (limited) {
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        const resetAt = retryAfterIso(retry, this.now) ?? (Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : undefined);
        return new RepoError('rate_limited', `GitHub rate limit reached (${where}).`, resetAt);
      }
      return new RepoError('repo_not_found_or_private', 'GitHub denied access to the repository.');
    }
    return new RepoError('upstream_error', `GitHub answered with status ${s}.`);
  }
}
