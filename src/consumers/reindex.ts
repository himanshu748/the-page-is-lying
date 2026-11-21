/**
 * Scheduled reindex (manifest scheduledTrigger `reindex-hourly`, function
 * `scheduled-reindex-fn`). Runs the same job as the queue consumer: the index
 * rebuilds only when the branch moved, so an hourly tick costs nothing when
 * the repo is quiet. Settings decide which repository is indexed; the event
 * carries nothing.
 */
import { forgeFetch, forgeKvs } from '../storage/forge';
import { runIndexJob } from './indexJob';

export const handler = async (): Promise<void> => {
  await runIndexJob({ kvs: forgeKvs(), fetch: forgeFetch, now: Date.now }, { body: { reason: 'manual' } });
};
