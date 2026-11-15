/**
 * Bitbucket Cloud adapter behind the same RepoSource interface.
 *
 * SHA: GET api.bitbucket.org/2.0/repositories/{ws}/{repo}/refs/branches/{name} (or refs/tags,
 * or the main branch name for the default). Snapshot: bitbucket.org/{ws}/{repo}/get/{sha}.tar.gz.
 * Checked on Nov 15, 2026: that URL answers 200 directly with no redirect, so no extra egress
 * host is needed.
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

export const BITBUCKET_API_HOST = 'api.bitbucket.org';
export const BITBUCKET_WEB_HOST = 'bitbucket.org';
export const BITBUCKET_SLUG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;

export interface BitbucketSourceOptions {
  workspace: string;
  repo: string;
  /** Optional read-only repository or workspace access token (Bearer). */
  token?: string;
  fetch: FetchFn;
  now?: () => number;
}

export class BitbucketSource implements RepoSource {
  readonly provider = 'bitbucket' as const;
  readonly fullName: string;
  private readonly workspace: string;
  private readonly repo: string;
  private readonly token: string | undefined;
  private readonly doFetch: FetchFn;
  private readonly now: () => number;

  constructor(opts: BitbucketSourceOptions) {
    if (!BITBUCKET_SLUG_RE.test(opts.workspace) || !BITBUCKET_SLUG_RE.test(opts.repo)) {
      throw new RepoError('invalid_repo_url', 'Invalid Bitbucket workspace or repository name.');
    }
    if (opts.token !== undefined && !validateToken(opts.token)) throw new RepoError('invalid_repo_url', 'The stored token has an invalid format.');
    this.workspace = opts.workspace;
    this.repo = opts.repo;
    this.token = opts.token;
    this.doFetch = opts.fetch;
    this.now = opts.now ?? Date.now;
    this.fullName = `${opts.workspace}/${opts.repo}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'the-page-is-lying', Accept: 'application/json' };
    if (this.token !== undefined) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async get(url: string, headers: Record<string, string>): Promise<FetchResponse> {
    try {
      return await this.doFetch(url, { method: 'GET', headers });
    } catch {
      throw new RepoError('upstream_error', 'Could not reach Bitbucket.');
    }
  }

  private repoUrl(): string {
    return `https://${BITBUCKET_API_HOST}/2.0/repositories/${this.workspace}/${this.repo}`;
  }

  private async mapError(res: FetchResponse): Promise<RepoError> {
    const s = res.status;
    if (s === 401 || s === 403 || s === 404) return new RepoError('repo_not_found_or_private', 'The repository was not found, or it is private.');
    if (s === 429) {
      return new RepoError('rate_limited', 'Bitbucket rate limit reached.', retryAfterIso(res.headers.get('retry-after'), this.now));
    }
    return new RepoError('upstream_error', `Bitbucket answered with status ${s}.`);
  }

  private async commitOf(kind: 'branches' | 'tags', name: string): Promise<{ sha?: string; res: FetchResponse }> {
    const res = await this.get(`${this.repoUrl()}/refs/${kind}/${encodePath(name)}`, this.headers());
    if (!res.ok) return { res };
    let sha: unknown;
    try {
      sha = ((await res.json()) as { target?: { hash?: unknown } } | null)?.target?.hash;
    } catch {
      throw new RepoError('upstream_error', 'Bitbucket returned an unreadable answer.');
    }
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new RepoError('upstream_error', 'Bitbucket returned an unexpected commit id.');
    return { sha, res };
  }

  async resolveRef(ref?: string): Promise<ResolvedRef> {
    let name = ref === undefined || ref === '' || ref === 'HEAD' ? undefined : ref;
    if (name !== undefined && !validateRef(name)) throw new RepoError('ref_not_found', 'The branch or tag name is not valid.');
    if (name === undefined) {
      const res = await this.get(`${this.repoUrl()}?fields=mainbranch.name`, this.headers());
      if (!res.ok) throw await this.mapError(res);
      let main: unknown;
      try {
        main = ((await res.json()) as { mainbranch?: { name?: unknown } } | null)?.mainbranch?.name;
      } catch {
        throw new RepoError('upstream_error', 'Bitbucket returned an unreadable answer.');
      }
      if (typeof main !== 'string' || !validateRef(main)) throw new RepoError('ref_not_found', 'The repository has no main branch.');
      name = main;
    }
    const branch = await this.commitOf('branches', name);
    if (branch.sha) return { sha: branch.sha, ref: ref ?? 'HEAD' };
    if (branch.res.status !== 404) throw await this.mapError(branch.res);
    const tag = await this.commitOf('tags', name);
    if (tag.sha) return { sha: tag.sha, ref: ref ?? 'HEAD' };
    if (tag.res.status !== 404) throw await this.mapError(tag.res);
    // Neither exists: tell a missing repository from a missing ref.
    const probe = await this.get(`${this.repoUrl()}?fields=name`, this.headers());
    if (!probe.ok) throw await this.mapError(probe);
    throw new RepoError('ref_not_found', 'The branch or tag was not found.');
  }

  async *snapshot(sha: string, limits: SnapshotLimits = DEFAULT_LIMITS, counters: SnapshotCounters = createCounters()): AsyncGenerator<RepoFile, void, undefined> {
    if (!SHA_RE.test(sha)) throw new RepoError('ref_not_found', 'A full 40 character commit id is required.');
    const url = `https://${BITBUCKET_WEB_HOST}/${this.workspace}/${this.repo}/get/${sha}.tar.gz`;
    const res = await this.get(url, this.token !== undefined ? { 'User-Agent': 'the-page-is-lying', Authorization: `Bearer ${this.token}` } : { 'User-Agent': 'the-page-is-lying' });
    if (!res.ok) throw await this.mapError(res);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limits.maxCompressedBytes) throw new RepoError('tarball_too_large', 'The repository archive is larger than the allowed size.');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > limits.maxCompressedBytes) throw new RepoError('tarball_too_large', 'The repository archive is larger than the allowed size.');
    yield* iterateTarGz(buf, limits, counters);
    if (counters.problem === 'tarball_too_large') throw new RepoError('tarball_too_large', 'The repository is larger than the allowed unpacked size.');
    if (counters.problem === 'invalid_archive') throw new RepoError('upstream_error', 'The repository archive could not be read.');
  }

  permalink(sha: string, path: string, line: number): string {
    return `https://${BITBUCKET_WEB_HOST}/${this.workspace}/${this.repo}/src/${sha}/${encodePath(path)}#lines-${Math.max(1, Math.floor(line))}`;
  }
}
