import type { HttpMethod } from '../model';
import { inCode, overlaps, type BlockContext, type Candidate } from './context';
import { stripPrefix, tokenizeSegment } from './shell';

const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const MAX_PATH_LENGTH = 300;
const MAX_SEGMENTS = 24;

/**
 * Normalizes an HTTP path: params ({id}, :id, <id>, <int:id>, [id]) become ":param",
 * query and fragment are cut, empty and "." segments and the trailing slash are dropped.
 * Idempotent.
 */
export function normalizeHttpPath(input: string): string {
  let path = input.slice(0, MAX_PATH_LENGTH);
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);
  const segments = path
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .slice(0, MAX_SEGMENTS)
    .map((s) => (/^\{.*\}$/.test(s) || /^<.*>$/.test(s) || /^\[.*\]$/.test(s) || /^:.+$/.test(s) ? ':param' : s));
  return '/' + segments.join('/');
}

/** Trims sentence punctuation that follows a path in prose. */
function trimTrailing(token: string): string {
  let end = token.length;
  while (end > 0) {
    const ch = token.charAt(end - 1);
    if (ch === '.' || ch === ',' || ch === ';' || ch === ':' || ch === '!' || ch === '?') end--;
    else if (ch === ')' && !token.slice(0, end).includes('(')) end--;
    else break;
  }
  return token.slice(0, end);
}

function isMethod(value: string): value is HttpMethod {
  return METHODS.has(value);
}

function parseUrl(url: string): { host: string; path: string } | null {
  const m = /^https?:\/\/(?:[^/?#@\s]*@)?([^/?#:\s]+)(?::\d+)?([^?#\s]*)/i.exec(url);
  if (!m) return null;
  const host = (m[1] ?? '').toLowerCase();
  if (host === '' || /[${}<>]/.test(host)) return null;
  const path = normalizeHttpPath(m[2] ?? '');
  if (path === '/') return null;
  return { host, path };
}

function curlCandidates(ctx: BlockContext): Candidate[] {
  const out: Candidate[] = [];
  for (const segment of ctx.segments) {
    for (const command of tokenizeSegment(segment)) {
      const tokens = stripPrefix(command.tokens);
      const first = tokens[0];
      if (!first || first.value !== 'curl') continue;
      let method: string | undefined;
      let hasData = false;
      let url: string | undefined;
      for (let i = 1; i < tokens.length; i++) {
        const value = tokens[i]?.value ?? '';
        if (value === '-X' || value === '--request') {
          method = tokens[i + 1]?.value.toUpperCase();
          i++;
        } else if (/^-X[A-Za-z]+$/.test(value)) {
          method = value.slice(2).toUpperCase();
        } else if (value.startsWith('--request=')) {
          method = value.slice('--request='.length).toUpperCase();
        } else if (/^(-d|--data(-raw|-binary|-urlencode)?|-F|--form|--json)(=|$)/.test(value)) {
          hasData = true;
        } else if (/^https?:\/\//i.test(value) && url === undefined) {
          url = value;
        }
      }
      if (url === undefined) continue;
      const parsed = parseUrl(url);
      if (!parsed) continue;
      const resolved = method ?? (hasData ? 'POST' : 'GET');
      if (!isMethod(resolved)) continue;
      const last = tokens[tokens.length - 1] ?? first;
      out.push({
        start: first.start,
        end: last.end,
        high: true,
        normalized: { type: 'http_endpoint', method: resolved, path: parsed.path, host: parsed.host },
      });
    }
  }
  return out;
}

export function extractHttp(ctx: BlockContext): Candidate[] {
  const out: Candidate[] = [];
  const text = ctx.text;

  const methodRe = /(?<![A-Za-z0-9_])(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)[ \t]+(\/[^\s`"'|]{0,300})/g;
  for (let m = methodRe.exec(text); m !== null; m = methodRe.exec(text)) {
    const method = m[1] ?? '';
    const token = trimTrailing(m[2] ?? '');
    const path = normalizeHttpPath(token);
    if (!isMethod(method) || path === '/') continue;
    const pathStart = m.index + m[0].length - (m[2] ?? '').length;
    const end = pathStart + token.length;
    out.push({
      start: m.index,
      end,
      high: inCode(ctx, pathStart, end),
      normalized: { type: 'http_endpoint', method, path },
    });
  }

  const curl = curlCandidates(ctx);

  for (const segment of ctx.segments) {
    const bareRe = /(?<![\w/:.@~-])\/v\d+(?:\/[^\s`"'|]*)?/g;
    for (let m = bareRe.exec(segment.text); m !== null; m = bareRe.exec(segment.text)) {
      const token = trimTrailing(m[0]);
      const start = segment.start + m.index;
      const range = { start, end: start + token.length };
      if (out.some((c) => overlaps(c, range)) || curl.some((c) => overlaps(c, range))) continue;
      out.push({
        ...range,
        high: true,
        normalized: { type: 'http_endpoint', method: 'ANY', path: normalizeHttpPath(token) },
      });
    }
  }

  return [...out, ...curl];
}
