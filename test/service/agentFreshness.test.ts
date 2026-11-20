import { describe, expect, it } from 'vitest';
import { toRepo } from '../../src/actions/envelope';
import type { Report, RepoIndex } from '../../src/core/model';
import { createClaimExtractor } from '../../src/service/extractor';
import { createAgentService } from '../../src/service/agentService';
import { makeIndex } from '../fixtures/match/builders';

const service = (staleReason?: 'rate_limited') =>
  createAgentService({
    indexLoader: { loadIndex: () => Promise.resolve({ ok: true, index: makeIndex({}) as RepoIndex, stale: false, ...(staleReason ? { staleReason } : {}) }) },
    extractor: createClaimExtractor(),
    clock: { now: () => new Date('2026-11-20T00:00:00Z') },
  } as unknown as Parameters<typeof createAgentService>[0]);

describe('agent results after a failed check for a newer commit', () => {
  it('are not stale, and say the index could not be compared', async () => {
    const out = await service('rate_limited').checkClaim({ claimText: '`POST /v1/charge`' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report).toMatchObject({ stale: false, freshnessUnchecked: true });
    expect(toRepo(out.report)).toMatchObject({ stale: false, freshnessUnchecked: true });
  });

  it('carry no such flag when the comparison succeeded', async () => {
    const out = await service().checkClaim({ claimText: '`POST /v1/charge`' });
    expect(out.ok && toRepo(out.report as Report)).not.toHaveProperty('freshnessUnchecked');
  });
});
