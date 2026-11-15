/**
 * Test helpers: fixture loading, a tiny tar.gz writer and a scripted fetch fake.
 * Fixture files carry a ".fixture" suffix (so lint and tsc ignore them); a leading
 * "_dot_" in a path segment stands for ".".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { RepoFile } from '../../src/core/index/types';

export const FIXTURE_ROOT = join(import.meta.dirname, '..', 'fixtures', 'repos');

export function loadFixture(name: string): RepoFile[] {
  const out: RepoFile[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, rel === '' ? entry : `${rel}/${entry}`);
        continue;
      }
      const clean = entry.replace(/\.fixture$/, '').replace(/^_dot_/, '.');
      const segs = (rel === '' ? [] : rel.split('/')).map((s) => s.replace(/^_dot_/, '.'));
      out.push({ path: [...segs, clean].join('/'), text: readFileSync(full, 'utf8') });
    }
  };
  walk(join(FIXTURE_ROOT, name), '');
  return out;
}

export function fixtureFile(name: string, path: string): RepoFile {
  const f = loadFixture(name).find((x) => x.path === path);
  if (!f) throw new Error(`fixture ${name}/${path} not found`);
  return f;
}

// ---------------------------------------------------------------------------
// tar writer
// ---------------------------------------------------------------------------

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name: string, size: number, type: string, prefix = ''): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(0o644, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(0, 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  if (prefix !== '') h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

function padded(data: Buffer): Buffer {
  const rem = data.length % 512;
  return rem === 0 ? data : Buffer.concat([data, Buffer.alloc(512 - rem)]);
}

export interface TarEntry {
  path: string;
  data?: Buffer | string;
  /** 'file' (default), 'dir' or 'symlink'. */
  type?: 'file' | 'dir' | 'symlink';
}

/** Build an uncompressed tar like GitHub's: pax global header first, then `<top>/<path>` entries. */
export function buildTar(top: string, entries: TarEntry[], opts: { pax?: boolean } = {}): Buffer {
  const parts: Buffer[] = [];
  if (opts.pax ?? true) {
    const rec = ' comment=0123456789abcdef0123456789abcdef01234567\n';
    const line = `${String(rec.length + String(rec.length).length)}${rec}`;
    const body = Buffer.from(line, 'utf8');
    parts.push(header('pax_global_header', body.length, 'g'), padded(body));
  }
  parts.push(header(`${top}/`, 0, '5'));
  for (const e of entries) {
    const full = `${top}/${e.path}`;
    const data = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : (e.data ?? Buffer.alloc(0));
    const type = e.type === 'dir' ? '5' : e.type === 'symlink' ? '2' : '0';
    let name = full;
    let prefix = '';
    if (Buffer.byteLength(full) > 100) {
      const cut = full.lastIndexOf('/', 155);
      prefix = full.slice(0, cut);
      name = full.slice(cut + 1);
    }
    const size = e.type === 'dir' || e.type === 'symlink' ? 0 : data.length;
    parts.push(header(name, size, type, prefix));
    if (size > 0) parts.push(padded(data));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function buildTarGz(top: string, entries: TarEntry[], opts: { pax?: boolean } = {}): Buffer {
  return gzipSync(buildTar(top, entries, opts));
}

export function filesToEntries(files: RepoFile[]): TarEntry[] {
  return files.map((f) => ({ path: f.path, data: f.text }));
}

// ---------------------------------------------------------------------------
// fetch fake
// ---------------------------------------------------------------------------

export interface FakeResponseInit {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  method: string;
}

export interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export function fakeResponse(init: FakeResponseInit = {}): FakeResponse {
  const status = init.status ?? 200;
  const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const body = init.body === undefined ? Buffer.alloc(0) : typeof init.body === 'string' ? Buffer.from(init.body) : init.body;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
    text: async () => body.toString('utf8'),
    json: async () => JSON.parse(body.toString('utf8')) as unknown,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  };
}

export type Route = (req: RecordedRequest) => FakeResponseInit | undefined;

/** A fetch fake: routes are tried in order, the first that returns a response wins. */
export function fakeFetch(routes: Route[]): { fetch: (url: string, init?: { headers?: Record<string, string>; method?: string }) => Promise<FakeResponse>; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const req: RecordedRequest = { url, headers: { ...(init?.headers ?? {}) }, method: init?.method ?? 'GET' };
      calls.push(req);
      for (const r of routes) {
        const res = r(req);
        if (res) return fakeResponse(res);
      }
      return fakeResponse({ status: 599, body: 'no route in fake' });
    },
  };
}
