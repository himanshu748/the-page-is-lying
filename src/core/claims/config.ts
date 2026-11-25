import { inCode, overlaps, urlRanges, type BlockContext, type Candidate } from './context';
import { FILE_EXTENSIONS, findFilePaths } from './files';

const CONFIG_EXTENSIONS: ReadonlySet<string> = new Set(['json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'env', 'properties', 'conf', 'cfg', 'xml']);
const TLDS: ReadonlySet<string> = new Set(['com', 'org', 'net', 'io', 'dev', 'app', 'ai', 'co', 'uk', 'de', 'in', 'me', 'us', 'edu', 'gov', 'local', 'internal']);
const NOT_CONFIG_ROOTS: ReadonlySet<string> = new Set(
  `console process window document os sys math json self this req res request response ctx util fs path Math JSON Object Array Promise String Number Date
   np pd e i`
    .split(/\s+/)
    .filter((s) => s !== ''),
);

const MAX_KEY_LENGTH = 100;
const MAX_SEGMENTS = 6;
const FILE_DISTANCE = 100;

function isConfigFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (/^\.env(\.|$)/.test(name)) return true;
  const dot = name.lastIndexOf('.');
  return dot > 0 && CONFIG_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function isPlausibleKey(token: string): boolean {
  if (token.length > MAX_KEY_LENGTH) return false;
  const segments = token.split('.');
  if (segments.length > MAX_SEGMENTS) return false;
  const first = segments[0] ?? '';
  const last = (segments[segments.length - 1] ?? '').toLowerCase();
  if (first.length < 2 || NOT_CONFIG_ROOTS.has(first)) return false;
  return !FILE_EXTENSIONS.has(last) && !TLDS.has(last);
}

export function findConfigFiles(text: string) {
  return findFilePaths(text, urlRanges(text)).filter((file) => isConfigFile(file.path));
}

export function extractConfig(ctx: BlockContext, files = findConfigFiles(ctx.text), offset = 0): Candidate[] {
  const out: Candidate[] = [];
  const text = ctx.text;
  const urls = urlRanges(text);

  const keyRe = /(?<![\w./@$-])[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)+(?![\w\-/(@])/g;
  for (let m = keyRe.exec(text); m !== null; m = keyRe.exec(text)) {
    const token = m[0];
    const range = { start: m.index, end: m.index + token.length };
    if (!isPlausibleKey(token) || urls.some((u) => overlaps(u, range))) continue;
    const sourceRange = { start: offset + range.start, end: offset + range.end };
    if (files.some((f) => overlaps(f, sourceRange))) continue;

    let nearest: { path: string; distance: number } | undefined;
    for (const f of files) {
      const distance = f.start >= sourceRange.end ? f.start - sourceRange.end : sourceRange.start - f.end;
      if (distance <= FILE_DISTANCE && (nearest === undefined || distance < nearest.distance)) {
        nearest = { path: f.path, distance };
      }
    }

    const high = inCode(ctx, range.start, range.end);
    let accepted = nearest !== undefined;
    if (!accepted && high) {
      const segment = ctx.segments.find((s) => range.start >= s.start && range.end <= s.end);
      if (segment !== undefined) {
        const exact = segment.start === range.start && segment.end === range.end;
        const assignment = segment.start === range.start && /^\s*[:=]/.test(text.slice(range.end, segment.end));
        accepted = exact || assignment;
      }
    }
    if (!accepted) continue;
    out.push({
      ...range,
      high,
      normalized:
        nearest !== undefined
          ? { type: 'config_key', keyPath: token, file: nearest.path }
          : { type: 'config_key', keyPath: token },
    });
  }
  return out;
}
