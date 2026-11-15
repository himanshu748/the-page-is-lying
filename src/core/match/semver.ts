/**
 * Minimal version range intersection (npm, PEP 440 style, Go, Maven plain versions).
 * Pure, no dependency. Returns undefined when a range cannot be parsed, so callers answer Unknown.
 * Pre-release and build tags are ignored.
 */

type Version = [number, number, number];

interface Bound {
  v: Version;
  inc: boolean;
}

interface Interval {
  lo?: Bound;
  hi?: Bound;
}

function cmp(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function intersectIntervals(a: Interval, b: Interval): Interval | undefined {
  const lo = pickLo(a.lo, b.lo);
  const hi = pickHi(a.hi, b.hi);
  if (lo && hi) {
    const c = cmp(lo.v, hi.v);
    if (c > 0 || (c === 0 && !(lo.inc && hi.inc))) return undefined;
  }
  const out: Interval = {};
  if (lo) out.lo = lo;
  if (hi) out.hi = hi;
  return out;
}

function pickLo(a: Bound | undefined, b: Bound | undefined): Bound | undefined {
  if (!a) return b;
  if (!b) return a;
  const c = cmp(a.v, b.v);
  if (c !== 0) return c > 0 ? a : b;
  return { v: a.v, inc: a.inc && b.inc };
}

function pickHi(a: Bound | undefined, b: Bound | undefined): Bound | undefined {
  if (!a) return b;
  if (!b) return a;
  const c = cmp(a.v, b.v);
  if (c !== 0) return c < 0 ? a : b;
  return { v: a.v, inc: a.inc && b.inc };
}

interface PartialVersion {
  parts: number[]; // specified numeric parts only (stops at the first wildcard)
}

function parseVersion(text: string): PartialVersion | undefined {
  const cleaned = text.replace(/^v/i, '').replace(/[-+].*$/, '');
  if (cleaned === '' || /^[*xX]$/.test(cleaned)) return { parts: [] };
  const segs = cleaned.split('.');
  if (segs.length > 3) return undefined;
  const parts: number[] = [];
  for (const seg of segs) {
    if (/^[*xX]$/.test(seg)) break;
    if (!/^\d+$/.test(seg)) return undefined;
    parts.push(Number(seg));
  }
  return { parts };
}

function full(parts: number[]): Version {
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Smallest version above every version sharing the given partial prefix. */
function bump(parts: number[]): Version {
  if (parts.length === 1) return [(parts[0] ?? 0) + 1, 0, 0];
  if (parts.length === 2) return [parts[0] ?? 0, (parts[1] ?? 0) + 1, 0];
  return [parts[0] ?? 0, parts[1] ?? 0, (parts[2] ?? 0) + 1];
}

function comparator(op: string, text: string): Interval | undefined {
  const parsed = parseVersion(text);
  if (!parsed) return undefined;
  const { parts } = parsed;
  if (parts.length === 0) {
    return op === '<' ? undefined : {};
  }
  const lowest = full(parts);
  switch (op) {
    case '':
    case '=':
    case '==':
      if (parts.length === 3) return { lo: { v: lowest, inc: true }, hi: { v: lowest, inc: true } };
      return { lo: { v: lowest, inc: true }, hi: { v: bump(parts), inc: false } };
    case '>=':
      return { lo: { v: lowest, inc: true } };
    case '>':
      return parts.length === 3 ? { lo: { v: lowest, inc: false } } : { lo: { v: bump(parts), inc: true } };
    case '<':
      return { hi: { v: lowest, inc: false } };
    case '<=':
      return parts.length === 3 ? { hi: { v: lowest, inc: true } } : { hi: { v: bump(parts), inc: false } };
    case '^': {
      const [major = 0, minor = 0, patch = 0] = parts;
      let upper: Version;
      if (major > 0 || parts.length === 1) upper = [major + 1, 0, 0];
      else if (minor > 0 || parts.length === 2) upper = [0, minor + 1, 0];
      else upper = [0, 0, patch + 1];
      return { lo: { v: lowest, inc: true }, hi: { v: upper, inc: false } };
    }
    case '~':
    case '~>': {
      const upper: Version = parts.length === 1 ? [(parts[0] ?? 0) + 1, 0, 0] : [parts[0] ?? 0, (parts[1] ?? 0) + 1, 0];
      return { lo: { v: lowest, inc: true }, hi: { v: upper, inc: false } };
    }
    case '~=': {
      const upper: Version = parts.length >= 3 ? [parts[0] ?? 0, (parts[1] ?? 0) + 1, 0] : [(parts[0] ?? 0) + 1, 0, 0];
      return { lo: { v: lowest, inc: true }, hi: { v: upper, inc: false } };
    }
    default:
      return undefined;
  }
}

/** Parses a range into a union of intervals. `[]` means an empty set. */
export function parseRange(range: string): Interval[] | undefined {
  const union: Interval[] = [];
  for (const alternative of range.split('||')) {
    let text = alternative.trim().replace(/\s+-\s+/g, ' HYPHEN ');
    text = text.replace(/(<=|>=|==|~=|~>|[<>=^~])\s+/g, '$1');
    const words = text.split(/[\s,]+/).filter((word) => word !== '');
    let acc: Interval | undefined = {};
    if (words.length === 0) {
      union.push({});
      continue;
    }
    for (let i = 0; i < words.length && acc; i++) {
      const word = words[i] ?? '';
      if (words[i + 1] === 'HYPHEN') {
        const from = comparator('>=', word);
        const to = comparator('<=', words[i + 2] ?? '');
        if (!from || !to) return undefined;
        acc = intersectIntervals(acc, from);
        if (acc) acc = intersectIntervals(acc, to);
        i += 2;
        continue;
      }
      const m = /^(<=|>=|==|~=|~>|!=|[<>=^~])?(.*)$/.exec(word);
      const op = m?.[1] ?? '';
      const rest = m?.[2] ?? '';
      if (op === '!=' || rest === '' || /[^0-9a-zA-Z.*+-]/.test(rest)) return undefined;
      const part = comparator(op, rest);
      if (!part) {
        if (op === '<' && /^[*xX]$/.test(rest)) {
          acc = undefined;
          break;
        }
        return undefined;
      }
      acc = intersectIntervals(acc, part);
    }
    if (acc) union.push(acc);
  }
  return union;
}

/** true or false when both ranges parse, undefined when either cannot be parsed. */
export function rangesIntersect(a: string, b: string): boolean | undefined {
  const left = parseRange(a);
  const right = parseRange(b);
  if (!left || !right) return undefined;
  return left.some((l) => right.some((r) => intersectIntervals(l, r) !== undefined));
}
