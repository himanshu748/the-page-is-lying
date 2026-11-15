/** Input validation for settings and macro config. Pure functions, no Forge imports. */

export const MAX_ADF_BYTES = 400 * 1024;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9._/-]{1,100}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DIGITS = /^[0-9]{1,20}$/;
const TOKEN = /^[\x21-\x7e]{1,255}$/;

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** Accepts `https://github.com/{owner}/{repo}` (optionally `.git` or a trailing slash). Returns the canonical URL. */
export function validateRepoUrl(input: unknown): Checked<string> {
  if (typeof input !== 'string') return { ok: false, message: 'Repository URL must be text.' };
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: 'Enter a URL such as https://github.com/owner/repo.' };
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port !== '' || url.username !== '' || url.password !== '') {
    return { ok: false, message: 'Only https://github.com/{owner}/{repo} URLs are supported.' };
  }
  if (url.search !== '' || url.hash !== '') return { ok: false, message: 'Remove the query or fragment from the URL.' };
  const parts = url.pathname.split('/').filter((part) => part !== '');
  if (parts.length !== 2) return { ok: false, message: 'The URL must name exactly an owner and a repository.' };
  const owner = parts[0] ?? '';
  const repo = (parts[1] ?? '').replace(/\.git$/, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    return { ok: false, message: 'The owner or repository name has characters GitHub does not allow.' };
  }
  return { ok: true, value: `https://github.com/${owner}/${repo}` };
}

export function validateRef(input: unknown): Checked<string> {
  if (input === undefined || input === null || input === '') return { ok: true, value: '' };
  if (typeof input !== 'string' || !REF.test(input) || input.includes('..') || input.startsWith('/') || input.endsWith('/')) {
    return { ok: false, message: 'Branch or tag may use letters, digits and . _ - / only.' };
  }
  return { ok: true, value: input };
}

export function validateHosts(input: unknown): Checked<string[]> {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input) || input.length > 10) return { ok: false, message: 'Give at most 10 service hosts.' };
  const hosts: string[] = [];
  for (const item of input) {
    const host = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (host === '') continue;
    if (!HOST.test(host)) return { ok: false, message: `"${host.slice(0, 60)}" is not a valid host name.` };
    if (!hosts.includes(host)) hosts.push(host);
  }
  return { ok: true, value: hosts };
}

export function validateJiraId(input: unknown, label: string): Checked<string> {
  if (input === undefined || input === null || input === '') return { ok: true, value: '' };
  if (typeof input !== 'string' || !DIGITS.test(input.trim())) return { ok: false, message: `${label} must be a number.` };
  return { ok: true, value: input.trim() };
}

export function validateToken(input: unknown): Checked<string> {
  if (typeof input !== 'string' || !TOKEN.test(input.trim())) {
    return { ok: false, message: 'The token must be 1 to 255 printable characters without spaces.' };
  }
  return { ok: true, value: input.trim() };
}

export function adfWithinLimit(adf: unknown): boolean {
  try {
    return JSON.stringify(adf).length <= MAX_ADF_BYTES;
  } catch {
    return false;
  }
}

export function isNumericId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{1,20}$/.test(value);
}
