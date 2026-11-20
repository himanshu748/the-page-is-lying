/**
 * gzip + tar reader for repository snapshots. `iterateTarGz` never throws: bad input
 * ends the iteration and sets `counters.problem`. Archive paths are untrusted: entries
 * with "..", absolute or NUL-containing paths are dropped, and only regular files are read.
 */
import { TextDecoder } from 'node:util';
import { constants, gunzipSync } from 'node:zlib';
import { wantsContent } from '../core/index/build';
import { baseName } from '../core/index/text';
import type { RepoFile, SnapshotCounters, SnapshotLimits } from './source';
import { DEFAULT_LIMITS } from './source';

const BLOCK = 512;
const MAX_PATH = 1024;
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock', 'go.sum', 'composer.lock', 'Gemfile.lock', 'Pipfile.lock', 'uv.lock', 'bun.lockb']);

function cstr(buf: Uint8Array, start: number, len: number): string {
  let end = start;
  const max = start + len;
  while (end < max && buf[end] !== 0) end++;
  return Buffer.from(buf.subarray(start, end)).toString('utf8');
}

function parseOctal(buf: Uint8Array, start: number, len: number): number {
  if (((buf[start] as number) & 0x80) !== 0) {
    // GNU base-256
    let v = 0;
    for (let i = start + 1; i < start + len; i++) {
      v = v * 256 + (buf[i] as number);
      if (v > Number.MAX_SAFE_INTEGER / 256) return Number.NaN;
    }
    return v;
  }
  const s = cstr(buf, start, len).trim();
  if (s === '') return 0;
  if (!/^[0-7]+$/.test(s)) return Number.NaN;
  return parseInt(s, 8);
}

function checksumOk(h: Uint8Array): boolean {
  const stored = parseOctal(h, 148, 8);
  if (Number.isNaN(stored)) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (h[i] as number);
  return sum === stored;
}

function isZero(h: Uint8Array): boolean {
  for (let i = 0; i < BLOCK; i++) if (h[i] !== 0) return false;
  return true;
}

function paxValue(data: Uint8Array, key: string): string | undefined {
  // "<len> key=value\n" records
  const prefix = `${key}=`;
  let pos = 0;
  let found: string | undefined;
  while (pos < data.length) {
    let sp = pos;
    while (sp < data.length && data[sp] !== 0x20) sp++;
    const len = parseInt(Buffer.from(data.subarray(pos, sp)).toString('ascii'), 10);
    if (!Number.isFinite(len) || len <= 0 || pos + len > data.length) break;
    const rec = Buffer.from(data.subarray(sp + 1, pos + len - 1)).toString('utf8');
    if (rec.startsWith(prefix)) found = rec.slice(prefix.length);
    pos += len;
  }
  return found;
}

const paxPath = (data: Uint8Array): string | undefined => paxValue(data, 'path');

/** How much of the compressed archive is inflated to read the first tar header. */
const COMMIT_ID_PROBE_BYTES = 8192;

/**
 * The commit id a `git archive` tarball was made from. GitHub writes it as the `comment` record of the
 * pax global header, which is the first entry. Only the start of the archive is inflated. Returns
 * undefined when the archive does not carry one.
 */
export function archiveCommitId(gz: Uint8Array): string | undefined {
  let head: Uint8Array;
  try {
    head = gunzipSync(gz.subarray(0, COMMIT_ID_PROBE_BYTES), { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: 1024 * 1024 });
  } catch {
    return undefined;
  }
  if (head.length < BLOCK * 2) return undefined;
  const h = head.subarray(0, BLOCK);
  if (!checksumOk(h) || String.fromCharCode(h[156] as number) !== 'g') return undefined;
  const size = parseOctal(h, 124, 12);
  if (Number.isNaN(size) || size <= 0 || BLOCK + size > head.length) return undefined;
  const id = paxValue(head.subarray(BLOCK, BLOCK + size), 'comment');
  return id !== undefined && /^[0-9a-f]{40}$/.test(id) ? id : undefined;
}

/** Strip the top-level folder and reject unsafe paths. */
export function cleanArchivePath(raw: string): string | undefined {
  if (raw.length === 0 || raw.length > MAX_PATH || raw.includes('\0') || raw.includes('\\')) return undefined;
  const segs = raw.split('/').filter((s) => s !== '');
  if (segs.length < 2) return undefined; // entries at the top level are folders or the archive's own metadata
  const rest = segs.slice(1);
  if (rest.some((s) => s === '..' || s === '.')) return undefined;
  return rest.join('/');
}

function looksBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8000);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}

export function* iterateTarGz(
  gz: Uint8Array,
  limits: SnapshotLimits = DEFAULT_LIMITS,
  counters?: SnapshotCounters,
): Generator<RepoFile, void, undefined> {
  const c: SnapshotCounters = counters ?? {
    filesIndexed: 0,
    filesSkipped: 0,
    skipped: { dir: 0, minified: 0, lockfile: 0, tooLarge: 0, binary: 0, overLimit: 0 },
    truncated: false,
    paths: [],
  };
  let tar: Uint8Array;
  try {
    tar = gunzipSync(gz, { maxOutputLength: limits.maxUncompressedBytes });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    c.problem = code === 'ERR_BUFFER_TOO_LARGE' || (e instanceof RangeError) ? 'tarball_too_large' : 'invalid_archive';
    return;
  }
  yield* iterateTar(tar, limits, c);
}

export function* iterateTar(tar: Uint8Array, limits: SnapshotLimits, c: SnapshotCounters): Generator<RepoFile, void, undefined> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const skipDirPaths: string[] = [];
  let pos = 0;
  let pending: string | undefined;
  let sawEntry = false;
  let ended = false;
  const finishTree = (): void => {
    for (const p of skipDirPaths) {
      if (c.paths.length >= limits.maxTreePaths) break;
      c.paths.push(p);
    }
  };
  try {
    while (pos + BLOCK <= tar.length) {
      const h = tar.subarray(pos, pos + BLOCK);
      if (isZero(h)) {
        ended = true;
        break;
      }
      if (!checksumOk(h)) {
        if (!sawEntry) c.problem = 'invalid_archive';
        else c.problem = c.problem ?? 'invalid_archive';
        break;
      }
      sawEntry = true;
      const size = parseOctal(h, 124, 12);
      if (Number.isNaN(size) || size < 0) {
        c.problem = 'invalid_archive';
        break;
      }
      const type = String.fromCharCode(h[156] as number);
      const dataStart = pos + BLOCK;
      const dataEnd = dataStart + size;
      if (dataEnd > tar.length) {
        c.problem = 'invalid_archive';
        break;
      }
      const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;
      const data = tar.subarray(dataStart, dataEnd);
      if (type === 'x') {
        pending = paxPath(data) ?? pending;
      } else if (type === 'g') {
        // global pax header (GitHub puts the commit id here): ignored
      } else if (type === 'L') {
        pending = cstr(data, 0, data.length);
      } else if (type === '0' || type === '\0' || type === '7') {
        const isUstar = cstr(h, 257, 5) === 'ustar';
        const name = cstr(h, 0, 100);
        const prefix = isUstar ? cstr(h, 345, 155) : '';
        const raw = pending ?? (prefix !== '' ? `${prefix}/${name}` : name);
        pending = undefined;
        const path = cleanArchivePath(raw);
        if (path !== undefined) {
          const file = handle(path, data, limits, c, decoder, skipDirPaths);
          if (file) yield file;
        }
      } else {
        pending = undefined; // directories, symlinks, devices: not read
      }
      pos = next;
    }
    if (!ended && pos !== tar.length && !c.problem) c.problem = 'invalid_archive';
  } catch {
    c.problem = c.problem ?? 'invalid_archive';
  }
  finishTree();
}

function handle(
  path: string,
  data: Uint8Array,
  limits: SnapshotLimits,
  c: SnapshotCounters,
  decoder: TextDecoder,
  skipDirPaths: string[],
): RepoFile | undefined {
  const segs = path.split('/');
  const base = segs[segs.length - 1] as string;
  if (segs.slice(0, -1).some((s) => limits.skipDirs.has(s))) {
    c.skipped.dir++;
    c.filesSkipped++;
    if (skipDirPaths.length < limits.maxTreePaths) skipDirPaths.push(path);
    return undefined;
  }
  if (c.paths.length < limits.maxTreePaths) c.paths.push(path);
  else c.truncated = true;
  if (!wantsContent(path)) return undefined;
  if (LOCKFILES.has(baseName(base))) {
    c.skipped.lockfile++;
    c.filesSkipped++;
    return undefined;
  }
  if (/\.min\.[a-z]+$/i.test(base)) {
    c.skipped.minified++;
    c.filesSkipped++;
    return undefined;
  }
  if (data.length > limits.maxFileBytes) {
    c.skipped.tooLarge++;
    c.filesSkipped++;
    return undefined;
  }
  if (looksBinary(data)) {
    c.skipped.binary++;
    c.filesSkipped++;
    return undefined;
  }
  if (c.filesIndexed >= limits.maxFiles) {
    c.skipped.overLimit++;
    c.filesSkipped++;
    c.truncated = true;
    return undefined;
  }
  c.filesIndexed++;
  return { path, text: decoder.decode(data) };
}
