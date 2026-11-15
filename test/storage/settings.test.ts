import { describe, expect, it } from 'vitest';
import { RepoError } from '../../src/repo/source';
import { clearToken, getSettings, getSettingsView, hasToken, normalizeSettings, readTokenForFetch, saveSettings, setToken } from '../../src/storage/settings';
import { FakeKvs } from './fakeKvs';

const TOKEN = 'github_pat_ABCDEFGHIJKLMNOPQRSTUV';
const NOW = () => Date.parse('2026-11-15T10:00:00Z');

describe('settings', () => {
  it('normalizes and stores the repo URL, ref and service hosts', async () => {
    const kvs = new FakeKvs();
    const s = await saveSettings(kvs, { repoUrl: 'https://github.com/himanshu748/payments-api.git/', ref: ' main ', serviceHosts: ['API.Example.com', 'api.example.com'], jiraProject: 'PAY' }, NOW);
    expect(s).toEqual({ repoUrl: 'https://github.com/himanshu748/payments-api', ref: 'main', serviceHosts: ['api.example.com'], jiraProject: 'PAY', updatedAt: '2026-11-15T10:00:00.000Z' });
    expect(await getSettings(kvs)).toEqual(s);
  });

  it('rejects bad URLs, refs, hosts and Jira fields', () => {
    expect(() => normalizeSettings({ repoUrl: 'https://evil.example/o/r' })).toThrow(RepoError);
    expect(() => normalizeSettings({ repoUrl: 'https://github.com/o/r', ref: '../x' })).toThrow();
    expect(() => normalizeSettings({ repoUrl: 'https://github.com/o/r', serviceHosts: ['bad host'] })).toThrow();
    expect(() => normalizeSettings({ repoUrl: 'https://github.com/o/r', serviceHosts: ['a/b'] })).toThrow();
    expect(() => normalizeSettings({ repoUrl: 'https://github.com/o/r', jiraProject: 'x<script>' })).toThrow();
  });

  it('stores tokens only through the secret APIs and never exposes them', async () => {
    const kvs = new FakeKvs();
    await saveSettings(kvs, { repoUrl: 'https://github.com/o/r' }, NOW);
    expect(await hasToken(kvs, 'github')).toBe(false);
    await setToken(kvs, 'github', ` ${TOKEN} `);
    expect(kvs.secrets.get('gh-token:site')).toBe(TOKEN);
    expect(JSON.stringify([...kvs.data.entries()])).not.toContain(TOKEN); // nothing in plain KVS
    expect(kvs.ops.some((o) => o.op === 'set' && o.keys.some((k) => k.includes('token')))).toBe(false);
    const view = await getSettingsView(kvs);
    expect(view?.tokenSaved).toEqual({ github: true, bitbucket: false });
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(await readTokenForFetch(kvs, 'github')).toBe(TOKEN);
    expect(await readTokenForFetch(kvs, 'bitbucket')).toBeUndefined();
    await clearToken(kvs, 'github');
    expect(await hasToken(kvs, 'github')).toBe(false);
  });

  it('rejects malformed tokens without echoing them', async () => {
    const kvs = new FakeKvs();
    const bad = 'has spaces and\nnewline-SECRETVALUE';
    await expect(setToken(kvs, 'github', bad)).rejects.toThrow('invalid format');
    await setToken(kvs, 'github', bad.replace(/\s/g, '')).catch(() => undefined);
    kvs.secrets.set('gh-token:site', bad); // a corrupted stored value is never used
    expect(await readTokenForFetch(kvs, 'github')).toBeUndefined();
  });
});
