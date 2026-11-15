/**
 * `IndexLoader` over Task B's storage: saved settings -> repoKey -> `getIndexForCheck`.
 *
 * The repository always comes from the saved site settings. A caller (macro configuration, agent input) may
 * name a repository, but only the saved one has an index and may be fetched, so a different one is refused
 * instead of being fetched. Free of Forge imports: `forgeCheckDeps` binds it.
 */
import { createRepoSource, parseRepoUrl, type RepoCoordinates } from '../repo';
import type { RepoSource } from '../repo/source';
import type { FetchFn } from '../repo/source';
import { getIndexForCheck } from '../storage/freshness';
import { repoKeyOf } from '../storage/keys';
import type { KvsLike } from '../storage/kvs';
import { getSettings, readTokenForFetch } from '../storage/settings';
import type { IndexLoader, IndexLoadResult, RepoSelector } from './check';

export interface IndexLoaderDeps {
  kvs: KvsLike;
  fetch: FetchFn;
  now: () => number;
  enqueue: (body: { repoKey: string; reason: 'missing' | 'stale' | 'manual' }) => Promise<void>;
}

function tryParse(url: string | undefined): RepoCoordinates | undefined {
  if (url === undefined || url === '') return undefined;
  try {
    return parseRepoUrl(url);
  } catch {
    return undefined;
  }
}

export function createIndexLoader(deps: IndexLoaderDeps): IndexLoader {
  return {
    async loadIndex(selector: RepoSelector): Promise<IndexLoadResult> {
      const settings = await getSettings(deps.kvs);
      const saved = tryParse(settings?.repoUrl);
      if (!settings || !saved) return { ok: false, reason: 'no_repo', message: 'No repository is configured.' };

      if (selector.repoUrl !== undefined && selector.repoUrl !== '') {
        const asked = tryParse(selector.repoUrl);
        const same = asked && asked.provider === saved.provider && asked.owner.toLowerCase() === saved.owner.toLowerCase() && asked.repo.toLowerCase() === saved.repo.toLowerCase();
        if (!same) return { ok: false, reason: 'index_missing', message: 'Only the repository saved in the app settings can be checked.' };
      }
      if (selector.ref !== undefined && selector.ref !== '' && selector.ref !== (settings.ref ?? '')) {
        return { ok: false, reason: 'index_missing', message: 'Only the branch saved in the app settings can be checked.' };
      }

      const repoKey = repoKeyOf(saved.provider, `${saved.owner}/${saved.repo}`, settings.ref ?? 'HEAD');
      const lookup = await getIndexForCheck(
        {
          kvs: deps.kvs,
          enqueue: deps.enqueue,
          now: deps.now,
          getSource: async (): Promise<RepoSource> => {
            const token = await readTokenForFetch(deps.kvs, saved.provider);
            return createRepoSource({ repoUrl: settings.repoUrl, fetch: deps.fetch, now: deps.now, ...(token !== undefined ? { token } : {}) });
          },
        },
        repoKey,
        settings.ref,
      );
      switch (lookup.state) {
        case 'indexing':
          return { ok: false, reason: 'indexing' };
        case 'unavailable':
          return { ok: false, reason: lookup.reason === 'repo_not_found_or_private' || lookup.reason === 'rate_limited' || lookup.reason === 'tarball_too_large' ? lookup.reason : 'index_missing', message: lookup.message };
        case 'ready':
          return { ok: true, index: lookup.index, stale: lookup.stale, ...(lookup.staleReason !== undefined ? { staleReason: lookup.staleReason } : {}) };
      }
    },
  };
}
