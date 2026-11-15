import { inCode, overlaps, urlRanges, type BlockContext, type Candidate } from './context.js';

const MAX_PATH_LENGTH = 200;
const MAX_SEGMENTS = 20;

export const FILE_EXTENSIONS: ReadonlySet<string> = new Set(
  `ts tsx js jsx mjs cjs json jsonc yaml yml toml md mdx py go java kt kts rb rs sh bash zsh sql env cfg conf ini xml html css scss
   txt lock properties gradle tf tfvars mk proto graphql gql c h cc cpp hpp cs php swift scala ex exs lua pl ps1 csv tsv example sample
   dockerfile`
    .split(/\s+/)
    .filter((s) => s !== ''),
);

/** File names that count without an extension. */
const KNOWN_NAMES: ReadonlySet<string> = new Set(['Dockerfile', 'Makefile', 'Procfile', 'Jenkinsfile', 'Gemfile', 'Rakefile', 'Vagrantfile']);

/** Product names that look like files ("Node.js"). */
const NOT_FILES: ReadonlySet<string> = new Set(
  ['node.js', 'next.js', 'vue.js', 'express.js', 'react.js', 'nuxt.js', 'nest.js', 'd3.js', 'three.js', 'ember.js', 'backbone.js', 'alpine.js', 'chart.js', 'moment.js', 'p5.js'],
);

/** Absolute paths that start here are system paths, not repo files. */
const SYSTEM_ROOTS: ReadonlySet<string> = new Set(
  `etc usr var bin sbin lib lib64 opt tmp home dev proc sys root mnt srv run boot media Users Library Applications System private Volumes`
    .split(/\s+/)
    .filter((s) => s !== ''),
);

/**
 * Normalizes a repo file path: strips leading "./" and "/", drops "." and empty segments,
 * keeps case and a trailing "/" (directory). Returns null when the path has a ".." segment
 * or is empty, so the result never contains "..". Idempotent.
 */
export function normalizeFilePath(input: string): string | null {
  if (input.length > MAX_PATH_LENGTH * 2) return null;
  const directory = input.endsWith('/');
  const parts = input.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.length === 0 || parts.length > MAX_SEGMENTS) return null;
  if (parts.some((s) => s === '..' || s.includes('\0'))) return null;
  const joined = parts.join('/');
  if (joined.length > MAX_PATH_LENGTH) return null;
  return directory ? joined + '/' : joined;
}

function hasFileShape(path: string): boolean {
  if (path.endsWith('/')) return path.length > 1;
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (KNOWN_NAMES.has(name)) return true;
  if (NOT_FILES.has(name.toLowerCase())) return false;
  if (/^\.env(\.|$)/.test(name)) return true;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return false;
  return FILE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export interface FileMatch {
  start: number;
  end: number;
  path: string;
}

/** Finds path-like tokens with a known extension or trailing slash. */
export function findFilePaths(text: string, skip: { start: number; end: number }[]): FileMatch[] {
  const matches: FileMatch[] = [];
  const re = /[A-Za-z0-9_.\-/]+/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    let token = m[0];
    const start = m.index;
    const before = start > 0 ? text.charAt(start - 1) : '';
    if (before === '@' || before === '$' || before === '%' || before === '~') continue;
    // Trailing sentence dots and dashes are not part of the path.
    token = token.replace(/[.-]+$/, '');
    if (token.length === 0 || token.startsWith('-')) continue;
    const range = { start, end: start + token.length };
    if (skip.some((r) => overlaps(r, range))) continue;
    if (token.startsWith('//')) continue;
    if (token.startsWith('/')) {
      const first = token.split('/').find((s) => s !== '');
      if (first === undefined || SYSTEM_ROOTS.has(first)) continue;
    }
    if (/^\d+(\.\d+)*$/.test(token)) continue;
    const path = normalizeFilePath(token);
    if (path === null || !hasFileShape(path)) continue;
    matches.push({ ...range, path });
  }
  return matches;
}

export function extractFiles(ctx: BlockContext): Candidate[] {
  const skip = urlRanges(ctx.text);
  return findFilePaths(ctx.text, skip).map((m) => ({
    start: m.start,
    end: m.end,
    high: inCode(ctx, m.start, m.end),
    normalized: { type: 'file_path', path: m.path },
  }));
}
