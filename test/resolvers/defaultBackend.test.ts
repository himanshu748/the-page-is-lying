import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestConfluence = vi.fn();
vi.mock('@forge/api', () => ({
  asUser: () => ({ requestConfluence }),
  asApp: () => ({ requestConfluence }),
  route: (strings: TemplateStringsArray) => strings.join(''),
}));
vi.mock('../../src/storage/forge', () => ({ forgeKvs: () => ({}), forgeEnqueue: () => Promise.resolve() }));
vi.mock('../../src/service/forge', () => ({ forgeCheckDeps: {} }));

const { defaultBackend } = await import('../../src/resolvers/defaultBackend');

const json = (body: unknown, ok = true) => ({ ok, json: () => Promise.resolve(body) });

describe('defaultBackend.isAdmin', () => {
  beforeEach(() => {
    requestConfluence.mockReset();
  });

  it('is true when the current user may administer the application', async () => {
    requestConfluence.mockResolvedValue(json({ operations: [{ operation: 'administer', targetType: 'application' }] }));
    expect(await defaultBackend.isAdmin('acc-1')).toBe(true);
    expect(requestConfluence).toHaveBeenCalledWith('/wiki/rest/api/user/current?expand=operations', expect.anything());
  });

  it('is false for a user without the administer operation, or a refused response, or no account id', async () => {
    requestConfluence.mockResolvedValue(json({ operations: [{ operation: 'use', targetType: 'application' }] }));
    expect(await defaultBackend.isAdmin('acc-1')).toBe(false);
    requestConfluence.mockResolvedValue(json({}, false));
    expect(await defaultBackend.isAdmin('acc-1')).toBe(false);
    expect(await defaultBackend.isAdmin(undefined)).toBe(false);
  });

  it('propagates NEEDS_AUTHENTICATION_ERR so Forge can show the consent prompt', async () => {
    const error = Object.assign(new Error('Authentication Required'), { name: 'NeedsAuthenticationError', status: 401 });
    requestConfluence.mockRejectedValue(error);
    await expect(defaultBackend.isAdmin('acc-1')).rejects.toBe(error);
  });
});
