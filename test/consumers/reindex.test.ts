import { describe, expect, it, vi } from 'vitest';

const runIndexJob = vi.fn((_deps: unknown, _event: unknown) => Promise.resolve({ outcome: 'unchanged', sha: 'x' }));
vi.mock('../../src/storage/forge', () => ({ forgeKvs: () => ({}), forgeFetch: () => Promise.resolve() }));
vi.mock('../../src/consumers/indexJob', () => ({ runIndexJob }));

const { handler } = await import('../../src/consumers/reindex');

describe('scheduled reindex', () => {
  it('does not force a rebuild: an unchanged branch head stays a no-op', async () => {
    await handler();
    expect(runIndexJob).toHaveBeenCalledTimes(1);
    expect(runIndexJob.mock.calls[0]?.[1]).toEqual({ body: { reason: 'stale' } });
  });
});
