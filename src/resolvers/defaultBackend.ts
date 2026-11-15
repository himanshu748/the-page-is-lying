/**
 * Default wiring used until integration connects Task B's storage and Task C's service.
 * Settings, token, counts and the queue push work now (plan keys `settings:site`, `gh-token:site`,
 * `counts:{contentId}:{version}`). `checkDocument` and `getIndexStatus` are the two integration points.
 */
import { asUser, route } from '@forge/api';
import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import type { ReportCounts } from '../core/model';
import type { PageContent, StoredSettings, UiBackend } from './backend';
import type { CheckResponse, IndexStatus } from './contract';

const SETTINGS_KEY = 'settings:site';
const TOKEN_KEY = 'gh-token:site';

const EMPTY_SETTINGS: StoredSettings = {
  repoUrl: '',
  ref: '',
  serviceHosts: [],
  jiraProjectId: '',
  jiraIssueTypeId: '',
};

const countsKey = (contentId: string, version: number | 'latest') => `counts:${contentId}:${version}`;

interface ConfluenceUser {
  operations?: { operation?: string; targetType?: string }[];
}

interface ConfluencePage {
  id?: string;
  title?: string;
  version?: { number?: number };
  body?: { atlas_doc_format?: { value?: string } };
}

export const defaultBackend: UiBackend = {
  checkDocument(): Promise<CheckResponse> {
    // INTEGRATION: call Task C checkDocument(adf, ...) and map its outcome to CheckResponse.
    return Promise.resolve({ state: 'error', message: 'The check service is not connected yet.' });
  },

  async readPage(contentId: string): Promise<PageContent | null> {
    const response = await asUser().requestConfluence(
      route`/wiki/api/v2/pages/${contentId}?body-format=atlas_doc_format`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return null;
    const page = (await response.json()) as ConfluencePage;
    const raw = page.body?.atlas_doc_format?.value;
    if (typeof raw !== 'string') return null;
    return {
      id: String(page.id ?? contentId),
      title: String(page.title ?? ''),
      version: Number(page.version?.number ?? 0),
      adf: JSON.parse(raw) as unknown,
    };
  },

  async isAdmin(accountId: string | undefined): Promise<boolean> {
    if (!accountId) return false;
    const response = await asUser().requestConfluence(route`/wiki/rest/api/user/current?expand=operations`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const user = (await response.json()) as ConfluenceUser;
    return (user.operations ?? []).some((op) => op.operation === 'administer' && op.targetType === 'application');
  },

  async loadSettings(): Promise<StoredSettings> {
    const stored = await kvs.get<Partial<StoredSettings>>(SETTINGS_KEY);
    return { ...EMPTY_SETTINGS, ...(stored ?? {}) };
  },

  async saveSettings(settings, token): Promise<void> {
    await kvs.set(SETTINGS_KEY, settings);
    if (token.clear) await kvs.deleteSecret(TOKEN_KEY);
    else if (token.set) await kvs.setSecret(TOKEN_KEY, token.set);
  },

  async hasToken(): Promise<boolean> {
    const value = await kvs.getSecret<string>(TOKEN_KEY);
    return typeof value === 'string' && value !== '';
  },

  getIndexStatus(): Promise<IndexStatus> {
    // INTEGRATION: read Task B's `idx:{repoKey}:current` pointer and in-progress or error marker.
    return Promise.resolve({ state: 'none' });
  },

  async enqueueIndex(): Promise<void> {
    // INTEGRATION: Task B's consumer defines the payload; plan section 5.1 sends `{ repoKey }`.
    const settings = await defaultBackend.loadSettings();
    await new Queue({ key: 'repo-index' }).push({ repoUrl: settings.repoUrl, ref: settings.ref });
  },

  async saveCounts(contentId: string, version: number, counts: ReportCounts): Promise<void> {
    await kvs.set(countsKey(contentId, version), counts);
    await kvs.set(countsKey(contentId, 'latest'), counts);
  },

  async getCounts(contentId: string, version: number | undefined): Promise<ReportCounts | null> {
    const stored = await kvs.get<ReportCounts>(countsKey(contentId, version ?? 'latest'));
    return stored ?? null;
  },
};
