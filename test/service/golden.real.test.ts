/**
 * Demo golden test with the REAL extractor (Task A), the REAL index builder (Task B) and the demo files (Task F).
 * Skipped until all of them exist, so integration can switch it on without editing the assertions.
 *
 * Integration: if Task B's builder has a different name or signature, adapt `buildIndexFromDemoRepo` below.
 * It must return a RepoIndex built from demo/payments-api/ with repo.fullName 'himanshu748/payments-api'.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtractedClaims } from '../../src/service/check';
import { checkDocument } from '../../src/service/check';
import type { RepoIndex } from '../../src/core/model';

const root = join(import.meta.dirname, '..', '..');
const demoRepo = join(root, 'demo', 'payments-api');
const brokenPage = join(root, 'demo', 'confluence', 'payments-api-runbook.adf.json');
const fixedPage = join(root, 'demo', 'confluence', 'payments-api-runbook.fixed.adf.json');

interface ClaimsModule {
  extractClaims(adf: unknown): ExtractedClaims | ExtractedClaims['claims'];
  extractClaimsFromText?(text: string): ExtractedClaims | ExtractedClaims['claims'];
}
interface IndexModule {
  buildIndex?(files: { path: string; text: string }[], repo: RepoIndex['repo']): RepoIndex;
  buildRepoIndex?(files: { path: string; text: string }[], repo: RepoIndex['repo']): RepoIndex;
}

async function tryImport<T>(relative: string): Promise<T | undefined> {
  const file = join(root, relative);
  if (!existsSync(file)) return undefined;
  try {
    return (await import(/* @vite-ignore */ file)) as T;
  } catch {
    return undefined;
  }
}

function readFiles(dir: string, base = dir, out: { path: string; text: string }[] = []): { path: string; text: string }[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) readFiles(full, base, out);
    else out.push({ path: full.slice(base.length + 1), text: readFileSync(full, 'utf8') });
  }
  return out;
}

const claimsModule = await tryImport<ClaimsModule>('src/core/claims/index.ts');
const indexModule = await tryImport<IndexModule>('src/core/index/index.ts');
const build = indexModule?.buildIndex ?? indexModule?.buildRepoIndex;
const ready = claimsModule !== undefined && build !== undefined && existsSync(demoRepo) && existsSync(brokenPage);

function buildIndexFromDemoRepo(): RepoIndex {
  if (!build) throw new Error('index builder missing');
  const repo = {
    provider: 'github' as const,
    fullName: 'himanshu748/payments-api',
    ref: 'main',
    sha: '3f2c1a9d0e5b7c8a1b2c3d4e5f60718293a4b5c6',
    indexedAt: '2026-12-01T10:00:00.000Z',
  };
  return build(readFiles(demoRepo), repo);
}

async function runPage(pageFile: string) {
  const claims = claimsModule;
  if (!claims) throw new Error('claim extractor missing');
  const index = buildIndexFromDemoRepo();
  const adf: unknown = JSON.parse(readFileSync(pageFile, 'utf8'));
  const out = await checkDocument(
    {
      indexLoader: { loadIndex: async () => ({ ok: true, index, stale: false }) },
      extractor: {
        extractClaims: (doc) => {
          const result = claims.extractClaims(doc);
          return Array.isArray(result) ? { claims: result, truncated: false } : result;
        },
        extractClaimsFromText: (text) => {
          const result = claims.extractClaimsFromText?.(text) ?? [];
          return Array.isArray(result) ? { claims: result, truncated: false } : result;
        },
      },
      clock: { now: () => new Date('2026-12-01T12:00:00.000Z') },
    },
    { adf },
  );
  if (!out.ok) throw new Error(out.message);
  return out.report;
}

describe.skipIf(!ready)('demo golden with the real extractor, index builder and demo files', () => {
  it('broken runbook: 2 verified, 3 contradicted, 1 no evidence, claim 1 cites src/routes.ts:88', async () => {
    const report = await runPage(brokenPage);
    expect(report.counts).toEqual({ claims: 6, verified: 2, contradicted: 3, unknown: 1 });
    const route = report.results.find((r) => r.claim.normalized.type === 'http_endpoint' && r.verdict === 'contradicted');
    expect(route?.evidence[0]).toMatchObject({ file: 'src/routes.ts', line: 88 });
  });

  it.skipIf(!existsSync(fixedPage))('fixed runbook: claim 1 is verified at src/routes.ts:88', async () => {
    const report = await runPage(fixedPage);
    expect(report.counts.contradicted).toBe(2);
    const route = report.results.find((r) => r.evidence[0]?.line === 88);
    expect(route).toMatchObject({ verdict: 'verified' });
  });
});

describe.skipIf(ready)('demo golden with the real modules (waiting for Tasks A, B, F)', () => {
  it.todo('switch on once src/core/claims, src/core/index and demo/** exist');
});
