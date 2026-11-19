/**
 * GitHub adapter: one REST call resolves a ref to a commit SHA, the code snapshot is one
 * tarball from codeload.github.com (PLAN.md section 8). Hosts are fixed here; nothing from
 * the repo or the page can change them.
 */
import { iterateTarGz } from './tar';
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

export const GITHUB_OWNER_RE = /^[A-Za-z0-9-]{1,39}$/;
export const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export interface GitHubSourceOptions {
  owner: string;
  repo: string;
  /** Optional read-only token. Only ever sent to api.github.com and codeload.github.com. */
  token?: string;
  fetch: FetchFn;
  now?: () => number;
}

export class GitHubSource implements RepoSource {
  readonly provider = 'github' as const;
  readonly fullName: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string | undefined;
  private readonly doFetch: FetchFn;
  private readonly now: () => number;

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
    if (!res.ok) throw await this.mapError(res, 'api');
    const sha = (await res.text()).trim();
    if (!SHA_RE.test(sha)) throw new RepoError('upstream_error', 'GitHub returned an unexpected commit id.');
    return { sha, ref: name };
  }

  async *snapshot(sha: string, limits: SnapshotLimits = DEFAULT_LIMITS, counters: SnapshotCounters = createCounters()): AsyncGenerator<RepoFile, void, undefined> {
    if (!SHA_RE.test(sha)) throw new RepoError('ref_not_found', 'A full 40 character commit id is required.');
    const url = `https://${GITHUB_CODELOAD_HOST}/${this.owner}/${this.repo}/tar.gz/${sha}`;
    const res = await this.get(url, this.headers());
    if (!res.ok) throw await this.mapError(res, 'codeload');
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limits.maxCompressedBytes) throw new RepoError('tarball_too_large', 'The repository archive is larger than the allowed size.');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > limits.maxCompressedBytes) throw new RepoError('tarball_too_large', 'The repository archive is larger than the allowed size.');
    yield* iterateTarGz(buf, limits, counters);
    if (counters.problem === 'tarball_too_large') throw new RepoError('tarball_too_large', 'The repository is larger than the allowed unpacked size.');
    if (counters.problem === 'invalid_archive') throw new RepoError('upstream_error', 'The repository archive could not be read.');
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
