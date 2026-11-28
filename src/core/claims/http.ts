import type { HttpMethod } from '../model';
import { catchAllMinimumSegments } from '../route-path';
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
    .map((s) => {
      if (catchAllMinimumSegments(s) !== undefined) return s;
      return /^\{.*\}$/.test(s) || /^<.*>$/.test(s) || /^\[.*\]$/.test(s) || /^:.+$/.test(s) ? ':param' : s;
    });
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
      let hasForm = false;
      let uploadFile: string | undefined;
      let head = false;
      let get = false;
      let url: string | undefined;
      let end = tokens.length;
      for (let i = 1; i < tokens.length; i++) {
        const value = tokens[i]?.value ?? '';
        if (value === '--next' || value === '-:') {
          end = i; // An independent transfer has its own option group.
          break;
        }
        const uploadOption = /^-([fGILsSv]*)T(.*)$/.exec(value);
        const shortBody = /^-([fGILsSv]*)([dF])(.*)$/.exec(value);
        const shortRoutingOption = /^-([fGILsSv]*)[ex](.*)$/.exec(value);
        if (shortBody) {
          if (shortBody[1]?.includes('I')) head = true;
          if (shortBody[1]?.includes('G')) get = true;
          if (!shortBody[3] && tokens[++i] === undefined) {
            url = undefined;
            break;
          }
          if (shortBody[2] === 'd') hasData = true;
          else hasForm = true;
        } else if (uploadOption || value === '--upload-file' || value.startsWith('--upload-file=')) {
          if (uploadOption?.[1]?.includes('I')) head = true;
          if (uploadOption?.[1]?.includes('G')) get = true;
          const file = value.startsWith('--upload-file=')
            ? value.slice('--upload-file='.length)
            : uploadOption?.[2] || tokens[++i]?.value;
          if (file === undefined) {
            url = undefined;
            break;
          }
          uploadFile ??= file;
        } else if (value === '-X' || value === '--request') {
          method = tokens[i + 1]?.value.toUpperCase();
          i++;
        } else if (/^-X[A-Za-z]+$/.test(value)) {
          method = value.slice(2).toUpperCase();
        } else if (value.startsWith('--request=')) {
          method = value.slice('--request='.length).toUpperCase();
        } else if (/^(--data(-ascii|-raw|-binary|-urlencode)?|--json)(=|$)/.test(value)) {
          hasData = true;
          if (!value.includes('=')) i++;
        } else if (/^--form(-string)?(=|$)/.test(value)) {
          hasForm = true;
          if (!value.includes('=')) i++;
        } else if (shortRoutingOption || value === '--referer' || value === '--proxy') {
          if (shortRoutingOption?.[1]?.includes('I')) head = true;
          if (shortRoutingOption?.[1]?.includes('G')) get = true;
          // Referer and proxy addresses can look like the request destination.
          if (!shortRoutingOption?.[2] && tokens[++i] === undefined) {
            url = undefined;
            break;
          }
        } else if (value === '--url' || value.startsWith('--url=')) {
          const target = value === '--url' ? tokens[++i]?.value : value.slice('--url='.length);
          if (!target) {
            url = undefined;
            break;
          }
          url ??= target;
        } else if (value === '-H' || value === '--header') {
          i++;
        } else if (value === '--head' || value === '--no-head') {
          head = value === '--head';
        } else if (value === '--get' || value === '--no-get') {
          get = value === '--get';
        } else if (/^-[fGILsSv]+$/.test(value)) {
          // The options in these bundles do not take arguments.
          if (value.includes('I')) head = true;
          if (value.includes('G')) get = true;
        } else if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && url === undefined) {
          url = value;
        }
      }
      if (url === undefined) continue;
      const parsed = parseUrl(url);
      if (!parsed) continue;
      // Curl rejects multipart with HEAD or raw data, and HEAD with a body.
      if ((hasForm && (head || hasData)) || (head && hasData && !get)) continue;
      // Curl can append the local filename to an upload directory target.
      const hasUpload = uploadFile !== undefined && uploadFile !== '';
      if (hasUpload && (head || hasForm || hasData || url.split(/[?#]/, 1)[0]?.endsWith('/'))) continue;
      const posts = hasForm || (hasData && !get);
      const resolved = method ?? (hasUpload ? 'PUT' : head ? 'HEAD' : posts ? 'POST' : 'GET');
      if (!isMethod(resolved)) continue;
      const last = tokens[end - 1] ?? first;
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
