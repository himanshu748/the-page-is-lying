/**
 * Text helpers for the index builders. Pure. Repo text is untrusted: it is only
 * scanned and parsed here, never evaluated, and never used as a regex or hostname.
 */
import type { HttpMethod } from '../model';

export const MAX_LINE_FOR_SNIPPET = 160;

/** Offsets of the first character of every line (line 1 starts at offset 0). */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** 1-based line of an offset, by binary search over `lineStarts`. */
export function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Trimmed source line cut to 160 chars with control characters removed. */
export function snippetOf(lines: string[], line: number): string {
  const raw = lines[line - 1] ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean.length > MAX_LINE_FOR_SNIPPET ? clean.slice(0, MAX_LINE_FOR_SNIPPET) : clean;
}

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** Replace a range with spaces but keep newlines, so offsets and line numbers stay valid. */
function blank(chars: string[], from: number, to: number): void {
  for (let i = from; i < to; i++) {
    const c = chars[i];
    if (c !== '\n' && c !== '\r') chars[i] = ' ';
  }
}

/**
 * Mask `//` and block comments in C-like source (JS, TS, Go, Java). String, template
 * and char literals are skipped so `'//'` inside a string is kept. Offsets are preserved.
 */
export function maskCStyleComments(text: string, opts: { backtickStrings?: boolean } = {}): string {
  const backtick = opts.backtickStrings ?? true;
  const chars = text.split('');
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      blank(chars, i, j);
      i = j;
    } else if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      blank(chars, i, j);
      i = j;
    } else if (c === '"' || c === "'" || (backtick && c === '`')) {
      let j = i + 1;
      while (j < n) {
        const e = text[j];
        if (e === '\\') {
          j += 2;
          continue;
        }
        if (e === c) break;
        if (e === '\n' && c !== '`') break;
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return chars.join('');
}

/** Sorted [start, end) spans of string literals in C-like source (comments are skipped). */
export function stringSpans(text: string, opts: { backtickStrings?: boolean } = {}): Array<[number, number]> {
  const backtick = opts.backtickStrings ?? true;
  const spans: Array<[number, number]> = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === '"' || c === "'" || (backtick && c === '`')) {
      let j = i + 1;
      while (j < n) {
        const e = text[j];
        if (e === '\\') {
          j += 2;
          continue;
        }
        if (e === c) break;
        if (e === '\n' && c !== '`') break;
        j++;
      }
      spans.push([i, Math.min(j + 1, n)]);
      i = j + 1;
    } else i++;
  }
  return spans;
}

/** True when `offset` lies strictly inside one of the spans. */
export function insideSpan(spans: Array<[number, number]>, offset: number): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = spans[mid] as [number, number];
    if (offset <= a) hi = mid - 1;
    else if (offset >= b) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * Mask `#` comments and the content of triple-quoted strings (docstrings) in Python
 * so examples inside docstrings are not indexed. Offsets are preserved.
 */
export function maskPython(text: string): string {
  const chars = text.split('');
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '#') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      blank(chars, i, j);
      i = j;
    } else if ((c === '"' || c === "'") && text[i + 1] === c && text[i + 2] === c) {
      const close = c.repeat(3);
      const end = text.indexOf(close, i + 3);
      const j = end === -1 ? n : end;
      blank(chars, i + 3, j);
      i = j + 3;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        const e = text[j];
        if (e === '\\') {
          j += 2;
          continue;
        }
        if (e === c || e === '\n') break;
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return chars.join('');
}

/** Mask `#` comments in shell-like text (Makefile, .env). */
export function maskHashComments(text: string): string {
  return text.replace(/(^|\s)#[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

const OPEN = '([{';
const CLOSE = ')]}';

/**
 * Given the index of an opening bracket, return the index of its matching close
 * (string and template aware), or -1 when unbalanced. Depth is bounded.
 */
export function findClose(text: string, openIdx: number): number {
  let depth = 0;
  const n = text.length;
  for (let i = openIdx; i < n; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        const e = text[j];
        if (e === '\\') {
          j += 2;
          continue;
        }
        if (e === c) break;
        j++;
      }
      i = j;
      continue;
    }
    if (OPEN.includes(c)) {
      depth++;
      if (depth > 200) return -1;
    } else if (CLOSE.includes(c)) {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

export interface Arg {
  /** Raw source of the argument, trimmed. */
  src: string;
  /** Present when the argument is a plain string literal (no interpolation). */
  literal?: string;
  offset: number;
}

/** Split call arguments at top-level commas. `inner` is the text between the parentheses. */
export function splitArgs(inner: string, baseOffset = 0): Arg[] {
  const args: Arg[] = [];
  let start = 0;
  let depth = 0;
  const n = inner.length;
  const push = (end: number): void => {
    const rawSeg = inner.slice(start, end);
    const src = rawSeg.trim();
    if (src === '' && args.length === 0 && end >= n) return;
    const lead = rawSeg.length - rawSeg.trimStart().length;
    const arg: Arg = { src, offset: baseOffset + start + lead };
    const lit = stringLiteral(src);
    if (lit !== undefined) arg.literal = lit;
    args.push(arg);
  };
  for (let i = 0; i < n; i++) {
    const c = inner[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        const e = inner[j];
        if (e === '\\') {
          j += 2;
          continue;
        }
        if (e === c) break;
        j++;
      }
      i = j;
    } else if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(n);
  return args;
}

/** The value of a plain string literal, or undefined (also for template literals with `${`). */
export function stringLiteral(src: string): string | undefined {
  const m = /^(?:[rRbBuUfF]{0,2})(["'`])((?:\\.|(?!\1)[^\\\n])*)\1$/s.exec(src.trim());
  if (!m) return undefined;
  if (/^[fF]/.test(src.trim())) return undefined; // Python f-string is dynamic
  const body = m[2] as string;
  if (m[1] === '`' && body.includes('${')) return undefined;
  return body;
}

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function toHttpMethod(word: string): HttpMethod | undefined {
  const up = word.toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(up) ? (up as HttpMethod) : undefined;
}

/** Posix style join of path prefixes. */
export function joinPaths(...parts: string[]): string {
  const joined = parts.filter((p) => p !== '').join('/');
  return joined;
}

export function extOf(path: string): string {
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Resolve a relative import specifier against a file, returning a normalized repo path or undefined. */
export function resolveRelative(fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const parts = dirName(fromFile) === '' ? [] : dirName(fromFile).split('/');
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}
