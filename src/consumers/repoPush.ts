/**
 * Repo-push webtrigger (manifest webtrigger `repo-push`, function `repo-push-fn`).
 * GitHub/Bitbucket sends a push event here; the handler enqueues the existing
 * `repo-index` job so merged work refreshes the index without waiting for the
 * freshness TTL. Verification and repoKey derivation live in repoPushJob.ts.
 */
import { parseRepoUrl } from '../repo';
import { forgeEnqueue, forgeKvs } from '../storage/forge';
import { repoKeyOf } from '../storage/keys';
import { getSettings } from '../storage/settings';
import { decideRepoPush } from './repoPushJob';
import type { WebtriggerRequest } from './repoPushJob';

async function configuredRepoKey(): Promise<string | undefined> {
  const settings = await getSettings(forgeKvs());
  if (settings === undefined) return undefined;
  try {
    const coords = parseRepoUrl(settings.repoUrl);
    return repoKeyOf(coords.provider, `${coords.owner}/${coords.repo}`, settings.ref ?? 'HEAD');
  } catch {
    return undefined;
  }
}

export const handler = async (event: WebtriggerRequest): Promise<{ statusCode: number; body: string }> => {
  const result = decideRepoPush({
    req: event,
    repoKey: await configuredRepoKey(),
    secret: process.env['WEBHOOK_SECRET'],
  });
  if (result.action === 'enqueue') {
    await forgeEnqueue({ repoKey: result.repoKey, reason: 'manual' });
    return { statusCode: 200, body: 'queued' };
  }
  return { statusCode: result.status, body: result.why };
};
