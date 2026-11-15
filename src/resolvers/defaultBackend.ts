/**
 * Forge binding of the real backend: Task B's KVS, queue and fetch, Task C's check service, and the one
 * page reader (`actions/pageReader.ts`, as the calling user). The logic is in `storageBackend.ts`.
 */
import { asUser, route } from '@forge/api';
import { readPageAsUser } from '../actions/pageReader';
import { forgeCheckDeps } from '../service/forge';
import { forgeEnqueue, forgeKvs } from '../storage/forge';
import type { PageContent, UiBackend } from './backend';
import { createStorageBackend } from './storageBackend';

interface ConfluenceUser {
  operations?: { operation?: string; targetType?: string }[];
}

async function readPage(contentId: string): Promise<PageContent | null> {
  const read = await readPageAsUser(contentId);
  return read.ok ? read.page : null;
}

async function isAdmin(accountId: string | undefined): Promise<boolean> {
  if (!accountId) return false;
  const response = await asUser().requestConfluence(route`/wiki/rest/api/user/current?expand=operations`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return false;
  const user = (await response.json()) as ConfluenceUser;
  return (user.operations ?? []).some((op) => op.operation === 'administer' && op.targetType === 'application');
}

export const defaultBackend: UiBackend = createStorageBackend({
  kvs: forgeKvs(),
  checkDeps: forgeCheckDeps,
  enqueue: forgeEnqueue,
  readPage,
  isAdmin,
  now: Date.now,
});
