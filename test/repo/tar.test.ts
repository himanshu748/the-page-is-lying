import { gzipSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, createCounters } from '../../src/repo/source';
import type { SnapshotLimits } from '../../src/repo/source';
import { cleanArchivePath, iterateTarGz } from '../../src/repo/tar';
import { buildTar, buildTarGz, filesToEntries, loadFixture } from './helpers';

function read(gz: Uint8Array, limits: SnapshotLimits = DEFAULT_LIMITS) {
  const counters = createCounters();
  const files = [...iterateTarGz(gz, limits, counters)];
  return { files, counters };
}

describe('iterateTarGz', () => {
  it('round-trips a fixture repo, stripping the top-level folder and ignoring the pax header', () => {
    const src = loadFixture('payments-api-mini');
    const { files, counters } = read(buildTarGz('owner-repo-abc123', filesToEntries(src)));
    const got = new Map(files.map((f) => [f.path, f.text]));
    expect(got.get('src/routes.ts')).toBe(src.find((f) => f.path === 'src/routes.ts')?.text);
    expect(got.has('package.json')).toBe(true);
    expect(got.has('CHANGELOG.md')).toBe(false); // not read by any builder, but listed in the tree
    expect(counters.paths).toContain('CHANGELOG.md');
    expect(counters.problem).toBeUndefined();
  });

  it('works without a pax header and with long paths in the ustar prefix field', () => {
    const long = `${'a'.repeat(60)}/${'b'.repeat(60)}/src/deep.ts`;
    const { files } = read(buildTarGz('top', [{ path: long, data: 'export {}' }], { pax: false }));
    expect(files.map((f) => f.path)).toEqual([long]);
  });

  it('counts skip dirs, minified files, lockfiles, large files and binaries', () => {
    const big = 'x'.repeat(2000);
    const gz = buildTarGz('t', [
      { path: 'node_modules/a/index.js', data: 'x' },
      { path: 'dist/out.js', data: 'x' },
      { path: 'static/app.min.js', data: 'x' },
      { path: 'package-lock.json', data: '{}' },
      { path: 'src/big.ts', data: big },
      { path: 'src/bin.ts', data: Buffer.from([0x61, 0x00, 0x62]) },
      { path: 'src/ok.ts', data: 'export const a = 1;' },
    ]);
    const { files, counters } = read(gz, { ...DEFAULT_LIMITS, maxFileBytes: 1000 });
    expect(files.map((f) => f.path)).toEqual(['src/ok.ts']);
    expect(counters.skipped).toEqual({ dir: 2, minified: 1, lockfile: 1, tooLarge: 1, binary: 1, overLimit: 0 });
    expect(counters.filesSkipped).toBe(6);
    expect(counters.filesIndexed).toBe(1);
    // skip-dir files still appear in the tree
    expect(counters.paths).toEqual(expect.arrayContaining(['node_modules/a/index.js', 'dist/out.js', 'src/ok.ts']));
    expect(counters.truncated).toBe(false);
  });

  it('stops reading text files at the file limit and marks the snapshot truncated', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ path: `src/f${i}.ts`, data: `export const n = ${i};` }));
    const { files, counters } = read(buildTarGz('t', entries), { ...DEFAULT_LIMITS, maxFiles: 5 });
    expect(files).toHaveLength(5);
    expect(counters.skipped.overLimit).toBe(7);
    expect(counters.truncated).toBe(true);
    expect(counters.paths).toHaveLength(12);
  });

  it('caps the tree and marks truncation', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ path: `docs/${i}.md`, data: 'x' }));
    const { counters } = read(buildTarGz('t', entries), { ...DEFAULT_LIMITS, maxTreePaths: 4 });
    expect(counters.paths).toHaveLength(4);
    expect(counters.truncated).toBe(true);
  });

  it('ignores directories and symlinks and drops traversal paths', () => {
    const gz = buildTarGz('t', [
      { path: 'src', type: 'dir' },
      { path: 'src/link.ts', type: 'symlink' },
      { path: '../escape.ts', data: 'x' },
      { path: 'a/../b.ts', data: 'x' },
      { path: 'src/ok.ts', data: 'ok' },
    ]);
    const { files } = read(gz);
    expect(files.map((f) => f.path)).toEqual(['src/ok.ts']);
  });

  it('reports invalid gzip and a truncated tar without throwing', () => {
    expect(read(Buffer.from('not gzip at all')).counters.problem).toBe('invalid_archive');
    const tar = buildTar('t', [{ path: 'src/a.ts', data: 'x'.repeat(5000) }]);
    const cut = gzipSync(tar.subarray(0, 700));
    const r = read(cut);
    expect(r.counters.problem).toBe('invalid_archive');
    expect(r.files).toEqual([]);
  });

  it('flags a decompression bomb as tarball_too_large', () => {
    const gz = buildTarGz('t', [{ path: 'src/a.ts', data: 'a'.repeat(200_000) }]);
    const r = read(gz, { ...DEFAULT_LIMITS, maxUncompressedBytes: 50_000 });
    expect(r.counters.problem).toBe('tarball_too_large');
    expect(r.files).toEqual([]);
  });

  it('never throws on random bytes, raw or gzipped', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        read(bytes);
        read(gzipSync(bytes));
        return true;
      }),
      { numRuns: 1000 },
    );
  });

  it('never throws on mutated valid archives', () => {
    const tar = buildTar('t', filesToEntries(loadFixture('payments-api-mini')));
    fc.assert(
      fc.property(fc.nat(tar.length - 1), fc.integer({ min: 0, max: 255 }), (idx, byte) => {
        const copy = Buffer.from(tar);
        copy[idx] = byte;
        read(gzipSync(copy));
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

describe('cleanArchivePath', () => {
  it('strips the first segment and rejects unsafe paths', () => {
    expect(cleanArchivePath('top/a/b.ts')).toBe('a/b.ts');
    expect(cleanArchivePath('top')).toBeUndefined();
    expect(cleanArchivePath('top/../x')).toBeUndefined();
    expect(cleanArchivePath('top/a\\b')).toBeUndefined();
    expect(cleanArchivePath('top/a\0b')).toBeUndefined();
    expect(cleanArchivePath('x'.repeat(2000) + '/a')).toBeUndefined();
  });
});
