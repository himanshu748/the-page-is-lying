/**
 * Site settings and the optional read-only repository token.
 *
 * The token is stored with kvs.setSecret only. It is read by `readTokenForFetch`, which is for
 * server-side adapter construction only: it is never logged, never put in an error message,
 * and never returned to a resolver that serves the frontend. The settings view exposes only
 * `tokenSaved` booleans.
 */
import type { RepoProvider } from '../core/model';
import { parseRepoUrl, validateRefName, validateToken } from '../repo';
import { RepoError } from '../repo/source';
import { SETTINGS_KEY, tokenKey } from './keys';
import { StorageError } from './kvs';
import type { KvsLike } from './kvs';

export interface SiteSettings {
  /** `https://github.com/{owner}/{repo}` or `https://bitbucket.org/{workspace}/{repo}`. */
  repoUrl: string;
  /** Branch or tag. Empty or absent means the default branch. */
  ref?: string;
  /** Hosts of services documented on pages that count as "this repo's service" for endpoint claims. */
  serviceHosts?: string[];
  jiraProject?: string;
  jiraIssueType?: string;
  /** ISO 8601. */
  updatedAt: string;
}

export interface SettingsInput {
  repoUrl: string;
  ref?: string | undefined;
  serviceHosts?: string[] | undefined;
  jiraProject?: string | undefined;
  jiraIssueType?: string | undefined;
}

/** What a resolver may send to the browser. */
export interface SettingsView extends Omit<SiteSettings, never> {
  tokenSaved: Record<RepoProvider, boolean>;
}

const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const JIRA_RE = /^[A-Za-z0-9 _.-]{1,60}$/;

/** Validate and normalize input. Throws RepoError('invalid_repo_url') or StorageError('invalid_settings'). */
export function normalizeSettings(input: SettingsInput, now: () => number = Date.now): SiteSettings {
  const c = parseRepoUrl(input.repoUrl);
  const host = c.provider === 'github' ? 'github.com' : 'bitbucket.org';
  const out: SiteSettings = { repoUrl: `https://${host}/${c.owner}/${c.repo}`, updatedAt: new Date(now()).toISOString() };
  const ref = input.ref?.trim();
  if (ref) {
    if (!validateRefName(ref)) throw new StorageError('invalid_settings', 'The branch or tag name is not valid.');
    out.ref = ref;
  }
  if (input.serviceHosts && input.serviceHosts.length > 0) {
    if (input.serviceHosts.length > 20) throw new StorageError('invalid_settings', 'At most 20 service hosts are allowed.');
    const hosts = input.serviceHosts.map((h) => h.trim().toLowerCase()).filter((h) => h !== '');
    if (hosts.some((h) => !HOST_RE.test(h))) throw new StorageError('invalid_settings', 'A service host is not a valid host name.');
    out.serviceHosts = [...new Set(hosts)];
  }
  for (const [k, v] of [['jiraProject', input.jiraProject], ['jiraIssueType', input.jiraIssueType]] as const) {
    const t = v?.trim();
    if (t) {
      if (!JIRA_RE.test(t)) throw new StorageError('invalid_settings', 'The Jira project or issue type contains unsupported characters.');
      out[k] = t;
    }
  }
  return out;
}

export async function getSettings(kvs: KvsLike): Promise<SiteSettings | undefined> {
  return kvs.get<SiteSettings>(SETTINGS_KEY);
}

export async function saveSettings(kvs: KvsLike, input: SettingsInput, now: () => number = Date.now): Promise<SiteSettings> {
  const s = normalizeSettings(input, now);
  await kvs.set(SETTINGS_KEY, s);
  return s;
}

export async function setToken(kvs: KvsLike, provider: RepoProvider, token: string): Promise<void> {
  const t = token.trim();
  if (!validateToken(t)) throw new StorageError('invalid_settings', 'The token has an invalid format.');
  await kvs.setSecret(tokenKey(provider), t);
}

export async function clearToken(kvs: KvsLike, provider: RepoProvider): Promise<void> {
  await kvs.deleteSecret(tokenKey(provider));
}

export async function hasToken(kvs: KvsLike, provider: RepoProvider): Promise<boolean> {
  return (await kvs.getSecret<string>(tokenKey(provider))) !== undefined;
}

/** Server side only: used to build a RepoSource. Never return this value to a caller that serves the frontend. */
export async function readTokenForFetch(kvs: KvsLike, provider: RepoProvider): Promise<string | undefined> {
  const t = await kvs.getSecret<string>(tokenKey(provider));
  return typeof t === 'string' && validateToken(t) ? t : undefined;
}

export async function getSettingsView(kvs: KvsLike): Promise<SettingsView | undefined> {
  const s = await getSettings(kvs);
  if (!s) return undefined;
  return { ...s, tokenSaved: { github: await hasToken(kvs, 'github'), bitbucket: await hasToken(kvs, 'bitbucket') } };
}

export { RepoError };
