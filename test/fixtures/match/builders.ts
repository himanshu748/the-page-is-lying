import { claimId } from '../../../src/core/ids';
import type { Claim, ClaimType, Coverage, IndexKind, NormalizedClaim, RepoIndex } from '../../../src/core/model';

export const SHA = '3f2c1a9d0e5b7c8a1b2c3d4e5f60718293a4b5c6';

export const baseRepo = {
  provider: 'github' as const,
  fullName: 'himanshu748/payments-api',
  ref: 'main',
  sha: SHA,
  indexedAt: '2026-12-01T10:00:00.000Z',
};

const completeAll: Record<IndexKind, Coverage> = {
  routes: 'complete',
  env: 'complete',
  cli: 'complete',
  config: 'complete',
  files: 'complete',
  packages: 'complete',
};

/** Empty complete index. Tests override only what they need. */
export function makeIndex(overrides: Partial<Omit<RepoIndex, 'coverage'>> & { coverage?: Partial<Record<IndexKind, Coverage>> } = {}): RepoIndex {
  const { coverage, ...rest } = overrides;
  return {
    schema: 'pil.index.v1',
    repo: { ...baseRepo },
    stats: { filesIndexed: 10, filesSkipped: 0, truncated: false },
    coverage: { ...completeAll, ...coverage },
    routes: [],
    env: [],
    cli: [],
    config: [],
    files: [],
    packages: [],
    configFiles: [],
    ...rest,
  };
}

let nextBlock = 0;

export function makeClaim(normalized: NormalizedClaim, raw: string, blockIndex = nextBlock++): Claim {
  const type: ClaimType = normalized.type;
  return {
    id: claimId(blockIndex, 0, normalized),
    type,
    raw,
    normalized,
    location: { blockIndex, start: 0, end: raw.length },
    confidence: 'high',
  };
}
