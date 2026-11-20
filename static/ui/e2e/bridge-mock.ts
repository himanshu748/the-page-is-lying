/**
 * Mock of the parts of @forge/bridge the UI uses. Selected through vite.config.e2e.ts.
 *
 * Query parameters:
 *   module=runbook-check (default) | runbook-byline | runbook-settings | runbook-get-started | runbook-drift
 *   repo=none starts the settings page without a saved repository (first run)
 *   contacts=none returns no page contacts      drift=empty | no_macro | no_repo | error | truncated for the space page
 *   scenario=ready (default) | indexing | indexing-then-ready | stale | rate_limited | rate_limited_stale
 *            | repo_not_found | no_repo | no_claims | error
 *   theme=light (default) | dark      rovo=1 enables Rovo      jira=1 configures the Jira target
 *   settings=auth-error makes saveSettings and indexNow reject, as when the admin has not allowed access yet
 *   settings=forbidden makes saveSettings and indexNow answer as a non-admin
 *   status=none (default) | indexing | ready | error      the index status shown on the settings page
 *
 * Every call is recorded on window.__pilCalls, __pilRouter and __pilRovo for assertions.
 * Tests can set window.__pilInvoke to stub resolver calls.
 */
import type { CheckResponse, DriftResponse, IndexStatus, SaveSettingsPayload } from '../../../src/resolvers/contract';
import { demoAdf, demoAudit, demoContacts, demoReport } from './fixtures';

declare global {
  interface Window {
    __pilInvoke?: (name: string, payload?: unknown) => unknown;
    __pilCalls?: { name: string; payload: unknown }[];
    __pilRouter?: unknown[];
    __pilNavigations?: unknown[];
    __pilRovo?: unknown[];
  }
}

const params = new URLSearchParams(window.location.search);
const moduleKey = params.get('module') ?? 'runbook-check';
const scenario = params.get('scenario') ?? 'ready';
const theme = params.get('theme') ?? 'light';

window.__pilCalls = [];
window.__pilRouter = [];
window.__pilNavigations = [];
window.__pilRovo = [];

export const view = {
  getContext: async () => ({
    moduleKey,
    siteUrl: 'https://example.atlassian.net',
    extension: {
      type: moduleKey,
      content: { id: '123456' },
      macro: { body: scenario === 'no_claims' ? demoAdf([{ segs: [{ text: 'Nothing checkable here.' }] }]) : demoAdf(), config: {} },
    },
  }),
  theme: {
    enable: async () => {
      document.documentElement.dataset['colorMode'] = theme;
    },
  },
};

let checks = 0;

function checkResponse(name: string): CheckResponse {
  const report = demoReport();
  switch (scenario) {
    case 'indexing':
      return { state: 'indexing' };
    case 'indexing-then-ready':
      return checks++ === 0 ? { state: 'indexing' } : { state: 'ready', report };
    case 'stale':
      return { state: 'ready', report: { ...report, stale: true } };
    case 'rate_limited':
      return { state: 'rate_limited', retryAfterSeconds: 1800 };
    case 'rate_limited_stale':
      return { state: 'rate_limited', retryAfterSeconds: 1800, report: { ...report, stale: true } };
    case 'repo_not_found':
      return { state: 'repo_not_found' };
    case 'no_repo':
      return { state: 'no_repo' };
    case 'error':
      return { state: 'error', message: 'The check failed. Try again in a minute.' };
    case 'no_claims':
      return {
        state: 'ready',
        report: { ...report, counts: { claims: 0, verified: 0, contradicted: 0, unknown: 0 }, results: [] },
      };
    default:
      return name === 'checkPage'
        ? { state: 'ready', report, page: { id: '123456', title: 'Payments API runbook', version: 7 } }
        : { state: 'ready', report };
  }
}

let settings = {
  repoUrl: params.get('repo') === 'none' ? '' : 'https://github.com/himanshu748/payments-api',
  ref: params.get('repo') === 'none' ? '' : 'main',
  serviceHosts: [] as string[],
  jiraProjectId: params.get('jira') === '1' ? '10000' : '',
  jiraIssueTypeId: params.get('jira') === '1' ? '10001' : '',
  tokenSaved: params.get('repo') !== 'none',
};

const status = params.get('status') ?? 'none';
const indexStatus = (): IndexStatus =>
  status === 'ready'
    ? {
        state: 'ready',
        ref: 'main',
        sha: '3f2c1a9d5e7b8c0a1f2e3d4c5b6a79881234abcd',
        indexedAt: '2026-12-01T10:00:00Z',
        filesIndexed: 14,
        filesSkipped: 0,
        truncated: false,
        coverage: { routes: 'complete', env: 'complete', cli: 'partial', config: 'none', files: 'complete', packages: 'complete' },
      }
    : status === 'indexing'
      ? { state: 'indexing' }
      : status === 'error'
        ? { state: 'error', lastError: 'rate_limited' }
        : { state: 'none' };

function driftResponse(): DriftResponse {
  switch (params.get('drift')) {
    case 'empty':
      return { state: 'ready', audit: { ...demoAudit(), totals: { claims: 0, verified: 0, contradicted: 0, unknown: 0 }, pages: [] } };
    case 'no_macro': {
      const audit = demoAudit();
      return {
        state: 'ready',
        audit: {
          ...audit,
          scope: { ...audit.scope, pagesRead: 12, pagesWithoutMacro: 12, pagesChecked: 0, pagesSkipped: 0, pagesWithoutClaims: 0 },
          totals: { claims: 0, verified: 0, contradicted: 0, unknown: 0 },
          pages: [],
        },
      };
    }
    case 'truncated': {
      const audit = demoAudit();
      return { state: 'ready', audit: { ...audit, pages: audit.pages.map((p) => ({ ...p, claimsTruncated: true })) } };
    }
    case 'no_repo':
      return { state: 'no_repo' };
    case 'error':
      return { state: 'error', message: 'The space audit failed. Try again in a minute.' };
    default:
      return { state: 'ready', audit: demoAudit() };
  }
}

export const invoke = async <T = unknown>(name: string, payload?: unknown): Promise<T> => {
  window.__pilCalls?.push({ name, payload });
  if (window.__pilInvoke) return (await window.__pilInvoke(name, payload)) as T;
  switch (name) {
    case 'checkBody':
    case 'checkPage':
      return checkResponse(name) as T;
    case 'getPageContacts':
      return { contacts: params.get('contacts') === 'none' ? [] : demoContacts } as T;
    case 'auditSpace':
      return driftResponse() as T;
    case 'getJiraTarget':
      return (settings.jiraProjectId ? { projectId: settings.jiraProjectId, issueTypeId: settings.jiraIssueTypeId } : null) as T;
    case 'getSettings':
      return settings as T;
    case 'getIndexStatus':
      return indexStatus() as T;
    case 'indexNow':
      if (params.get('settings') === 'auth-error') throw new Error('Authentication Required');
      return (params.get('settings') === 'forbidden'
        ? { ok: false, error: 'forbidden', message: 'Only a Confluence administrator can start indexing.' }
        : { ok: true }) as T;
    case 'saveSettings': {
      if (params.get('settings') === 'auth-error') throw new Error('Authentication Required');
      if (params.get('settings') === 'forbidden') {
        return { ok: false, error: 'forbidden', message: 'Only a Confluence administrator can change these settings.' } as T;
      }
      const input = payload as SaveSettingsPayload;
      settings = {
        ...settings,
        repoUrl: input.repoUrl,
        ref: input.ref ?? '',
        serviceHosts: input.serviceHosts ?? [],
        tokenSaved: input.clearToken ? false : input.token ? true : settings.tokenSaved,
      };
      return { ok: true, settings } as T;
    }
    default:
      throw new Error(`No mock for resolver "${name}"`);
  }
};

export const router = {
  open: async (target: unknown) => {
    window.__pilRouter?.push(target);
  },
  navigate: async (target: unknown) => {
    window.__pilNavigations?.push(target);
  },
};

export const rovo = {
  isEnabled: async () => params.get('rovo') === '1',
  open: async (options: unknown) => {
    window.__pilRovo?.push(options);
  },
};
