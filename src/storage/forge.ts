/**
 * Forge bindings: the real KVS, fetch and queue. Only the queue consumer, resolvers and
 * actions import this file; everything else takes the interfaces so tests can use fakes.
 */
import { fetch as forgeFetchApi } from '@forge/api';
import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import type { FetchFn } from '../repo/source';
import type { KvsLike } from './kvs';

export const INDEX_QUEUE_KEY = 'repo-index';

export function forgeKvs(): KvsLike {
  return {
    get: <T>(key: string) => kvs.get<T>(key),
    set: (key, value, options) => (options ? kvs.set(key, value, options) : kvs.set(key, value)),
    delete: (key) => kvs.delete(key),
    batchSet: (items) => kvs.batchSet(items),
    batchGet: <T>(items: Array<{ key: string }>) => kvs.batchGet<T>(items),
    batchDelete: (items) => kvs.batchDelete(items),
    getSecret: <T>(key: string) => kvs.getSecret<T>(key),
    setSecret: (key, value) => kvs.setSecret(key, value),
    deleteSecret: (key) => kvs.deleteSecret(key),
  };
}

/** Forge `fetch` (egress is limited to the hosts in manifest.yml). */
export const forgeFetch: FetchFn = async (url, init) => forgeFetchApi(url, init);

export async function forgeEnqueue(body: { repoKey: string; reason: 'missing' | 'stale' | 'manual' }): Promise<void> {
  await new Queue({ key: INDEX_QUEUE_KEY }).push({ body });
}
