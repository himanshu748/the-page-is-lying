import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Report, ReportCounts } from '../../src/core/model';
import { setBackend } from '../../src/resolvers/backend';
import type { CheckDocumentInput, PageContent, StoredSettings, UiBackend } from '../../src/resolvers/backend';
import { dynamicProperties, titleFor } from '../../src/resolvers/byline';
import type { CheckResponse, IndexStatus } from '../../src/resolvers/contract';
import { handler } from '../../src/resolvers/ui';
import { validateHosts, validateRef, validateRepoUrl } from '../../src/resolvers/validate';

const report: Report = {
  schema: 'pil.report.v1',
  repo: { provider: 'github', fullName: 'o/r', ref: 'main', sha: 'a'.repeat(40), indexedAt: '2026-12-01T10:00:00Z' },
  stale: false,
  counts: { claims: 3, verified: 1, contradicted: 2, unknown: 0 },
  limits: {
    maxClaims: 200,
    claimsTruncated: false,
    filesIndexed: 1,
    filesSkipped: 0,
    indexTruncated: false,
    coverage: { routes: 'complete', env: 'complete', cli: 'complete', config: 'none', files: 'complete', packages: 'complete' },
  },
  results: [],
};

interface Fake extends UiBackend {
  saved: { settings: StoredSettings; token: { set?: string; clear?: boolean } }[];
  enqueued: number;
  counts: Map<string, ReportCounts>;
  checks: CheckDocumentInput[];
}

function makeBackend(opts: { admin?: boolean; check?: CheckResponse; page?: PageContent | null } = {}): Fake {
  const state: Fake = {
    saved: [],
    enqueued: 0,
    counts: new Map(),
    checks: [],
    checkDocument: (input) => {
      state.checks.push(input);
      return Promise.resolve(opts.check ?? { state: 'ready', report });
    },
    readPage: () => Promise.resolve(opts.page === undefined ? { id: '42', title: 'Runbook', version: 3, adf: { type: 'doc', content: [] } } : opts.page),
    isAdmin: () => Promise.resolve(opts.admin ?? true),
    loadSettings: () =>
      Promise.resolve({ repoUrl: 'https://github.com/o/r', ref: '', serviceHosts: [], jiraProjectId: '10000', jiraIssueTypeId: '10001' }),
    saveSettings: (settings, token) => {
      state.saved.push({ settings, token });
      return Promise.resolve();
    },
    hasToken: () => Promise.resolve(true),
    getIndexStatus: (): Promise<IndexStatus> => Promise.resolve({ state: 'ready' }),
    enqueueIndex: () => {
      state.enqueued += 1;
      return Promise.resolve();
    },
    saveCounts: (id, version, counts) => {
      state.counts.set(`${id}:${version}`, counts);
      return Promise.resolve();
    },
    getCounts: (id, version) => Promise.resolve(state.counts.get(`${id}:${version ?? 'latest'}`) ?? null),
  };
  return state;
}

const call = (functionKey: string, payload: unknown, context: Record<string, unknown>) =>
  handler({ call: { functionKey, payload }, context }) as Promise<Record<string, unknown> | null>;

const settingsCtx = { moduleKey: 'runbook-settings', accountId: 'acc-1' };
const macroCtx = { moduleKey: 'runbook-check', accountId: 'acc-1' };
const validSave = { repoUrl: 'https://github.com/o/r' };

let backend: Fake;
beforeEach(() => {
  backend = makeBackend();
  setBackend(backend);
});
afterEach(() => setBackend(undefined));

describe('validateRepoUrl', () => {
  it('accepts and canonicalises GitHub URLs', () => {
    expect(validateRepoUrl('https://github.com/himanshu748/payments-api')).toEqual({ ok: true, value: 'https://github.com/himanshu748/payments-api' });
    expect(validateRepoUrl(' https://github.com/o/r.git/ ')).toEqual({ ok: true, value: 'https://github.com/o/r' });
  });
  it.each([
    'http://github.com/o/r',
    'https://evil.com/o/r',
    'https://github.com.evil.com/o/r',
    'https://user:pw@github.com/o/r',
    'https://github.com:8443/o/r',
    'https://github.com/o',
    'https://github.com/o/r/tree/main',
    'https://github.com/o/r?x=1',
    'https://github.com/-bad-/r',
    'https://github.com/o/..',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('rejects %s', (input) => {
    expect(validateRepoUrl(input).ok).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(validateRepoUrl(42).ok).toBe(false);
    expect(validateRepoUrl(undefined).ok).toBe(false);
  });
});

describe('validateRef and validateHosts', () => {
  it('accepts normal refs and rejects traversal', () => {
    expect(validateRef('release/1.2')).toEqual({ ok: true, value: 'release/1.2' });
    expect(validateRef('')).toEqual({ ok: true, value: '' });
    expect(validateRef('a..b').ok).toBe(false);
    expect(validateRef('a b').ok).toBe(false);
    expect(validateRef('/x').ok).toBe(false);
  });
  it('lowercases, dedupes and validates hosts', () => {
    expect(validateHosts(['API.Example.com', 'api.example.com', ' '])).toEqual({ ok: true, value: ['api.example.com'] });
    expect(validateHosts(['not a host']).ok).toBe(false);
    expect(validateHosts(['http://x.com']).ok).toBe(false);
    expect(validateHosts(Array.from({ length: 11 }, (_, i) => `h${i}.example.com`)).ok).toBe(false);
  });
});

describe('saveSettings', () => {
  it('saves valid settings for an admin on the settings module, stores the token and enqueues indexing', async () => {
    const result = await call('saveSettings', { ...validSave, ref: 'main', token: 'ghp_abc', serviceHosts: ['API.example.com'], jiraProjectId: '10000', jiraIssueTypeId: '10001' }, settingsCtx);
    expect(result).toMatchObject({ ok: true });
    expect(backend.saved).toHaveLength(1);
    expect(backend.saved[0]?.token).toEqual({ set: 'ghp_abc' });
    expect(backend.saved[0]?.settings.serviceHosts).toEqual(['api.example.com']);
    expect(backend.enqueued).toBe(1);
    expect(JSON.stringify(result)).not.toContain('ghp_abc');
  });

  it('rejects calls from other modules without touching storage', async () => {
    for (const moduleKey of ['runbook-check', 'runbook-byline', '', undefined]) {
      const result = await call('saveSettings', validSave, { moduleKey, accountId: 'acc-1' });
      expect(result).toMatchObject({ ok: false, error: 'forbidden' });
    }
    expect(backend.saved).toHaveLength(0);
    expect(backend.enqueued).toBe(0);
  });

  it('lets a failing admin check (for example NEEDS_AUTHENTICATION_ERR) reach Forge instead of swallowing it', async () => {
    const needsAuth = Object.assign(new Error('Authentication Required'), { name: 'NeedsAuthenticationError' });
    setBackend((backend = { ...makeBackend(), isAdmin: () => Promise.reject(needsAuth) }));
    await expect(call('saveSettings', validSave, settingsCtx)).rejects.toBe(needsAuth);
    await expect(call('indexNow', undefined, settingsCtx)).rejects.toBe(needsAuth);
  });

  it('rejects non-admins', async () => {
    setBackend((backend = makeBackend({ admin: false })));
    const result = await call('saveSettings', validSave, settingsCtx);
    expect(result).toMatchObject({ ok: false, error: 'forbidden' });
    expect(backend.saved).toHaveLength(0);
  });

  it.each([
    [{ repoUrl: 'https://evil.com/o/r' }],
    [{ repoUrl: 'ftp://github.com/o/r' }],
    [{ ...validSave, ref: '../x' }],
    [{ ...validSave, serviceHosts: ['bad host'] }],
    [{ ...validSave, jiraProjectId: 'abc', jiraIssueTypeId: '1' }],
    [{ ...validSave, jiraProjectId: '1' }],
    [{ ...validSave, token: 'has space' }],
    [{}],
  ])('rejects invalid input %j', async (payload) => {
    const result = await call('saveSettings', payload, settingsCtx);
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
    expect(backend.saved).toHaveLength(0);
  });

  it('keeps the stored token when none is sent and clears it on request', async () => {
    await call('saveSettings', validSave, settingsCtx);
    await call('saveSettings', { ...validSave, clearToken: true }, settingsCtx);
    expect(backend.saved.map((s) => s.token)).toEqual([{}, { clear: true }]);
  });

  it('also accepts a module key with an app and environment suffix', async () => {
    const result = await call('saveSettings', validSave, { moduleKey: 'runbook-settings', extension: {}, accountId: 'a' });
    expect(result).toMatchObject({ ok: true });
  });
});

describe('getSettings, getIndexStatus, indexNow', () => {
  it('never returns the token and only answers the settings module', async () => {
    const ok = await call('getSettings', undefined, settingsCtx);
    expect(ok).toMatchObject({ repoUrl: 'https://github.com/o/r', tokenSaved: true });
    expect(Object.keys(ok ?? {})).not.toContain('token');
    expect(await call('getSettings', undefined, macroCtx)).toEqual({ error: 'forbidden' });
    expect(await call('getIndexStatus', undefined, macroCtx)).toMatchObject({ state: 'error', lastError: 'forbidden' });
    expect(await call('getIndexStatus', undefined, settingsCtx)).toEqual({ state: 'ready' });
  });

  it('indexNow needs the settings module and an admin', async () => {
    expect(await call('indexNow', undefined, macroCtx)).toMatchObject({ ok: false, error: 'forbidden' });
    setBackend((backend = makeBackend({ admin: false })));
    expect(await call('indexNow', undefined, settingsCtx)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(backend.enqueued).toBe(0);
    setBackend((backend = makeBackend()));
    expect(await call('indexNow', undefined, settingsCtx)).toEqual({ ok: true });
    expect(backend.enqueued).toBe(1);
  });

  it('getJiraTarget returns ids only when both are set', async () => {
    expect(await call('getJiraTarget', undefined, macroCtx)).toEqual({ projectId: '10000', issueTypeId: '10001' });
    backend.loadSettings = () => Promise.resolve({ repoUrl: '', ref: '', serviceHosts: [], jiraProjectId: '', jiraIssueTypeId: '' });
    expect(await call('getJiraTarget', undefined, macroCtx)).toBeNull();
  });
});

describe('checkBody', () => {
  it('passes the ADF and validated overrides to the service', async () => {
    const adf = { type: 'doc', content: [] };
    const result = await call('checkBody', { adf, contentId: '42', config: { repoUrl: 'https://github.com/a/b', ref: 'dev' } }, macroCtx);
    expect(result).toMatchObject({ state: 'ready' });
    expect(backend.checks).toEqual([{ adf, repoUrl: 'https://github.com/a/b', ref: 'dev', contentId: '42' }]);
  });

  it('rejects ADF over 400 KB before calling the service', async () => {
    const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(401 * 1024) }] }] };
    const result = await call('checkBody', { adf }, macroCtx);
    expect(result).toMatchObject({ state: 'error' });
    expect(backend.checks).toHaveLength(0);
  });

  it('rejects an invalid macro repository override', async () => {
    const result = await call('checkBody', { adf: {}, config: { repoUrl: 'https://evil.com/a/b' } }, macroCtx);
    expect(result).toMatchObject({ state: 'error' });
    expect(backend.checks).toHaveLength(0);
  });

  it('maps a service failure to an error state', async () => {
    backend.checkDocument = () => Promise.reject(new Error('boom: secret detail'));
    const result = await call('checkBody', { adf: {} }, macroCtx);
    expect(result).toEqual({ state: 'error', message: 'The check failed. Try again in a minute.' });
  });

  it('passes non-ready states through', async () => {
    setBackend((backend = makeBackend({ check: { state: 'rate_limited', retryAfterSeconds: 60 } })));
    expect(await call('checkBody', { adf: {} }, macroCtx)).toEqual({ state: 'rate_limited', retryAfterSeconds: 60 });
  });
});

describe('checkPage', () => {
  it('reads the page as the user, checks it and stores counts by version', async () => {
    const result = await call('checkPage', { contentId: '42' }, { moduleKey: 'runbook-byline' });
    expect(result).toMatchObject({ state: 'ready', page: { id: '42', title: 'Runbook', version: 3 } });
    expect(backend.counts.get('42:3')).toEqual(report.counts);
  });

  it('rejects bad ids and missing pages', async () => {
    expect(await call('checkPage', { contentId: '../42' }, macroCtx)).toMatchObject({ state: 'error' });
    expect(await call('checkPage', {}, macroCtx)).toMatchObject({ state: 'error' });
    setBackend((backend = makeBackend({ page: null })));
    expect(await call('checkPage', { contentId: '42' }, macroCtx)).toMatchObject({ state: 'error' });
    expect(backend.checks).toHaveLength(0);
  });
});

describe('byline dynamicProperties', () => {
  const counts = (c: Partial<ReportCounts>): ReportCounts => ({ claims: 0, verified: 0, contradicted: 0, unknown: 0, ...c });

  it('builds titles from counts', () => {
    expect(titleFor(null)).toBe('Runbook check');
    expect(titleFor(counts({ claims: 3, contradicted: 3 }))).toBe('Runbook check: 3 contradicted');
    expect(titleFor(counts({ claims: 2, unknown: 2 }))).toBe('Runbook check: 2 no evidence');
    expect(titleFor(counts({ claims: 1, verified: 1 }))).toBe('Runbook check: 1 verified');
    expect(titleFor(counts({}))).toBe('Runbook check');
  });

  it('reads counts:{contentId}:{version} through the backend', async () => {
    backend.counts.set('42:7', counts({ claims: 5, contradicted: 3, verified: 2 }));
    const result = await dynamicProperties({ extension: { content: { id: '42', version: { number: 7 } } } });
    expect(result.title).toBe('Runbook check: 3 contradicted');
  });

  it('falls back to latest counts when the version is unknown', async () => {
    backend.counts.set('42:latest', counts({ claims: 1, contradicted: 1 }));
    expect((await dynamicProperties({ extension: { content: { id: 42 } } })).title).toBe('Runbook check: 1 contradicted');
  });

  it('returns the plain title for missing input, bad ids and backend failures', async () => {
    expect((await dynamicProperties(undefined)).title).toBe('Runbook check');
    expect((await dynamicProperties({ extension: { content: { id: '../x' } } })).title).toBe('Runbook check');
    backend.getCounts = () => Promise.reject(new Error('kvs down'));
    expect((await dynamicProperties({ extension: { content: { id: '42' } } })).title).toBe('Runbook check');
  });
});

describe('moduleKey handling', () => {
  it('does not trust an extension moduleKey from the payload', async () => {
    const spy = vi.spyOn(backend, 'saveSettings');
    const result = await call('saveSettings', { ...validSave, moduleKey: 'runbook-settings' }, macroCtx);
    expect(result).toMatchObject({ ok: false, error: 'forbidden' });
    expect(spy).not.toHaveBeenCalled();
  });
});
