/**
 * Mock of the parts of @forge/bridge the UI uses. Selected through vite.config.e2e.ts.
 * Pick the module with ?module=runbook-check (default), runbook-byline or runbook-settings.
 * Tests can set window.__pilInvoke to stub resolver calls.
 */
declare global {
  interface Window {
    __pilInvoke?: (name: string, payload?: unknown) => unknown;
  }
}

const moduleKey = new URLSearchParams(window.location.search).get('module') ?? 'runbook-check';

export const view = {
  getContext: async () => ({
    moduleKey,
    extension: { type: moduleKey, content: { id: '123456' }, macro: { body: undefined, config: {} } },
  }),
  theme: { enable: async () => undefined },
};

export const invoke = async <T = unknown>(name: string, payload?: unknown): Promise<T> => {
  if (window.__pilInvoke) return (await window.__pilInvoke(name, payload)) as T;
  throw new Error(`No mock for resolver "${name}"`);
};

export const router = { open: async (_target: unknown) => undefined, navigate: async (_target: unknown) => undefined };

export const rovo = { isEnabled: async () => false, open: async (_options: unknown) => undefined };
