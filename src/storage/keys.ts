/**
 * KVS key helpers. Keys must match the KVS key regex and stay under 500 characters, so
 * every variable segment is escaped to [A-Za-z0-9._-] ("#" plus hex for anything else; "#" is allowed in KVS keys).
 */
import { createHash } from 'node:crypto';
import type { IndexKind, RepoProvider } from '../core/model';

export const INDEX_KINDS: readonly IndexKind[] = ['routes', 'env', 'cli', 'config', 'files', 'packages'];

const MAX_SEGMENT = 160;

export function escapeKeySegment(raw: string): string {
  let out = '';
  for (const byte of Buffer.from(raw, 'utf8')) {
    const ch = String.fromCharCode(byte);
    out += /[A-Za-z0-9._-]/.test(ch) ? ch : `#${byte.toString(16).padStart(2, '0').toUpperCase()}`;
  }
  if (out.length > MAX_SEGMENT) return `h#${createHash('sha256').update(raw).digest('hex').slice(0, 40)}`;
  return out;
}

/** The repoKey used in every key: `gh:{owner}/{repo}@{ref}` escaped (Bitbucket uses `bb:`). */
export function repoKeyOf(provider: RepoProvider, fullName: string, ref: string): string {
  return escapeKeySegment(`${provider === 'github' ? 'gh' : 'bb'}:${fullName}@${ref === '' ? 'HEAD' : ref}`);
}

export const pointerKey = (repoKey: string): string => `idx:${repoKey}:current`;
export const shardKey = (repoKey: string, sha: string, kind: IndexKind, n: number): string => `idx:${repoKey}:${sha}:${kind}:${n}`;
export const headKey = (repoKey: string): string => `head:${repoKey}`;
export const statusKey = (repoKey: string): string => `status:${repoKey}`;
export const SETTINGS_KEY = 'settings:site';
export const tokenKey = (provider: RepoProvider): string => (provider === 'github' ? 'gh-token:site' : 'bb-token:site');
