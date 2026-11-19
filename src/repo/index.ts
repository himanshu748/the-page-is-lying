/**
 * Repo URL parsing and the adapter factory. Repo coordinates come only from validated
 * settings; they are never taken from page text, repo files or agent input.
 */
import type { RepoProvider } from '../core/model';
import { BITBUCKET_SLUG_RE, BitbucketSource } from './bitbucket';
import { GITHUB_OWNER_RE, GITHUB_REPO_RE, GitHubSource } from './github';
import { RepoError, validateRef } from './source';
import type { FetchFn, RepoSource } from './source';

export * from './source';
export { GitHubSource } from './github';
export { BitbucketSource } from './bitbucket';
export { iterateTarGz } from './tar';

export interface RepoCoordinates {
  provider: RepoProvider;
  /** GitHub owner or Bitbucket workspace. */
  owner: string;
  repo: string;
}

/**
 * Accepts `https://github.com/{owner}/{repo}` and `https://bitbucket.org/{workspace}/{repo}`,
 * with an optional `.git` suffix and trailing slash. Anything else is `invalid_repo_url`.
 */
export function parseRepoUrl(input: string): RepoCoordinates {
  const bad = (): never => {
    throw new RepoError('invalid_repo_url', 'Enter a repository URL like https://github.com/owner/repo or https://bitbucket.org/workspace/repo.');
  };
  if (input.length > 300) return bad();
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return bad();
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '' || url.search !== '' || url.hash !== '') return bad();
  const segs = url.pathname.split('/').filter((s) => s !== '');
  if (segs.length !== 2) return bad();
  const owner = segs[0] as string;
  const repo = (segs[1] as string).replace(/\.git$/, '');
  if (url.hostname === 'github.com') {
    if (!GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_RE.test(repo) || repo === '.' || repo === '..') return bad();
    return { provider: 'github', owner, repo };
  }
  if (url.hostname === 'bitbucket.org') {
    if (!BITBUCKET_SLUG_RE.test(owner) || !BITBUCKET_SLUG_RE.test(repo)) return bad();
    return { provider: 'bitbucket', owner, repo };
  }
  return bad();
}

export function validateRefName(ref: string | undefined): boolean {
  return ref === undefined || ref === '' || validateRef(ref);
}

export interface CreateSourceOptions {
  repoUrl: string;
  token?: string;
  fetch: FetchFn;
  now?: () => number;
}

export function createRepoSource(opts: CreateSourceOptions): RepoSource {
  const c = parseRepoUrl(opts.repoUrl);
  const base = { fetch: opts.fetch, ...(opts.token !== undefined ? { token: opts.token } : {}), ...(opts.now ? { now: opts.now } : {}) };
  return c.provider === 'github' ? new GitHubSource({ owner: c.owner, repo: c.repo, ...base }) : new BitbucketSource({ workspace: c.owner, repo: c.repo, ...base });
}
