/**
 * The real `UiBackend`, built from injected pieces so it runs against fakes in tests. `defaultBackend.ts`
 * binds it to Forge. One storage layout: everything about settings, tokens, index status and indexing goes
 * through Task B's helpers (`src/storage`), and every check goes through the one check service (`src/service`).
 */
import type { ReportCounts } from '../core/model';
import { parseRepoUrl } from '../repo';
import type { RepoProvider } from '../core/model';
import { checkDocument, type CheckDeps, type CheckOutcome } from '../service/check';
import { readPointer } from '../storage/indexStore';
import { repoKeyOf } from '../storage/keys';
import type { KvsLike } from '../storage/kvs';
import { clearToken, getSettings, hasToken, saveSettings, setToken } from '../storage/settings';
import type { SiteSettings } from '../storage/settings';
import { getStatus, isInFlight, setStatus } from '../storage/status';
import type { PageContent, StoredSettings, UiBackend } from './backend';
import type { CheckResponse, IndexStatus } from './contract';

export interface StorageBackendDeps {
  kvs: KvsLike;
  checkDeps: () => CheckDeps;
  enqueue: (body: { repoKey: string; reason: 'missing' | 'stale' | 'manual' }) => Promise<void>;
  readPage: (contentId: string) => Promise<PageContent | null>;
  isAdmin: (accountId: string | undefined) => Promise<boolean>;
  now: () => number;
}

const EMPTY_SETTINGS: StoredSettings = { repoUrl: '', ref: '', serviceHosts: [], jiraProjectId: '', jiraIssueTypeId: '' };

const countsKey = (contentId: string, version: number | 'latest'): string => `counts:${contentId}:${version}`;

/** Maps a check outcome to the UI states. A check that did not run is never a report. */
export function toCheckResponse(outcome: CheckOutcome): CheckResponse {
  if (outcome.ok) {
    if (outcome.staleReason === 'rate_limited') return { state: 'rate_limited', report: outcome.report };
    return { state: 'ready', report: outcome.report };
  }
  switch (outcome.error) {
    case 'indexing':
      return { state: 'indexing' };
    case 'no_repo':
      return { state: 'no_repo' };
    case 'repo_not_found_or_private':
      return { state: 'repo_not_found' };
    case 'rate_limited':
      return { state: 'rate_limited' };
    default:
      return { state: 'error', message: outcome.message };
  }
}

function fromSite(site: SiteSettings | undefined): StoredSettings {
  if (!site) return { ...EMPTY_SETTINGS };
  return {
    repoUrl: site.repoUrl,
    ref: site.ref ?? '',
    serviceHosts: site.serviceHosts ?? [],
    jiraProjectId: site.jiraProject ?? '',
    jiraIssueTypeId: site.jiraIssueType ?? '',
  };
}

function providerOf(repoUrl: string | undefined): RepoProvider {
  try {
    return repoUrl ? parseRepoUrl(repoUrl).provider : 'github';
  } catch {
    return 'github';
  }
}

function repoKeyFor(site: SiteSettings): string | undefined {
  try {
    const c = parseRepoUrl(site.repoUrl);
    return repoKeyOf(c.provider, `${c.owner}/${c.repo}`, site.ref ?? 'HEAD');
  } catch {
    return undefined;
  }
}

export function createStorageBackend(deps: StorageBackendDeps): UiBackend {
  const { kvs } = deps;
  return {
    async checkDocument(input): Promise<CheckResponse> {
      const outcome = await checkDocument(deps.checkDeps(), {
        adf: input.adf,
        repoRef: { ...(input.repoUrl ? { repoUrl: input.repoUrl } : {}), ...(input.ref ? { ref: input.ref } : {}) },
        ...(input.contentId ? { contentId: input.contentId } : {}),
      });
      return toCheckResponse(outcome);
    },

    readPage: deps.readPage,
    isAdmin: deps.isAdmin,

    async loadSettings(): Promise<StoredSettings> {
      return fromSite(await getSettings(kvs));
    },

    async saveSettings(settings, token): Promise<void> {
      const saved = await saveSettings(
        kvs,
        {
          repoUrl: settings.repoUrl,
          ref: settings.ref,
          serviceHosts: settings.serviceHosts,
          jiraProject: settings.jiraProjectId,
          jiraIssueType: settings.jiraIssueTypeId,
        },
        deps.now,
      );
      const provider = providerOf(saved.repoUrl);
      if (token.clear) await clearToken(kvs, provider);
      else if (token.set) await setToken(kvs, provider, token.set);
    },

    async hasToken(): Promise<boolean> {
      return hasToken(kvs, providerOf((await getSettings(kvs))?.repoUrl));
    },

    async getIndexStatus(): Promise<IndexStatus> {
      const site = await getSettings(kvs);
      const repoKey = site ? repoKeyFor(site) : undefined;
      if (!site || !repoKey) return { state: 'none' };
      const [status, pointer] = await Promise.all([getStatus(kvs, repoKey), readPointer(kvs, repoKey)]);
      const built: Partial<IndexStatus> = pointer
        ? {
            ref: pointer.repo.ref,
            sha: pointer.repo.sha,
            indexedAt: pointer.repo.indexedAt,
            filesIndexed: pointer.stats.filesIndexed,
            filesSkipped: pointer.stats.filesSkipped,
            truncated: pointer.stats.truncated,
            coverage: pointer.coverage,
          }
        : {};
      if (status?.state === 'queued' || status?.state === 'indexing') return { ...built, state: 'indexing' };
      if (status?.state === 'error') return { ...built, state: 'error', lastError: status.reason ?? 'index_missing' };
      if (pointer) return { ...built, state: 'ready' };
      return { state: 'none' };
    },

    async enqueueIndex(): Promise<void> {
      const site = await getSettings(kvs);
      const repoKey = site ? repoKeyFor(site) : undefined;
      if (!repoKey) return;
      const status = await getStatus(kvs, repoKey);
      if (isInFlight(status, deps.now())) return;
      const iso = new Date(deps.now()).toISOString();
      await setStatus(kvs, repoKey, { ...(status ?? {}), state: 'queued', updatedAt: iso, startedAt: iso });
      await deps.enqueue({ repoKey, reason: 'manual' });
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
}
