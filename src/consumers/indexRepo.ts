/**
 * Async queue consumer `repo-index` (manifest function `index-repo-fn`, timeout 300 s).
 * All logic lives in indexJob.ts; this file only binds it to Forge KVS and fetch.
 */
import { forgeFetch, forgeKvs } from '../storage/forge';
import { runIndexJob } from './indexJob';
import type { IndexRepoEvent } from './indexJob';

export type { IndexRepoEvent } from './indexJob';

export const handler = async (event: IndexRepoEvent): Promise<void> => {
  await runIndexJob({ kvs: forgeKvs(), fetch: forgeFetch, now: Date.now }, event);
};
