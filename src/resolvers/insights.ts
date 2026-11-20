/**
 * Readers behind the "who to ask" line and the space drift page. Kept apart from `UiBackend` so the storage
 * backend stays about settings, indexes and checks. Tests swap it with `setInsights()`.
 */
import type { AuditSpaceResult } from '../actions/auditSpace';
import type { PageContact } from '../actions/contacts';

export interface Insights {
  /** Owner, last editor and creator of a page, read as the calling user. Empty on any failure. */
  pageContacts(contentId: string): Promise<PageContact[]>;
  /** Checks the most recently edited pages of a space as the calling user. */
  auditSpace(spaceId: string): Promise<AuditSpaceResult>;
}

let current: Insights | undefined;

export function setInsights(insights: Insights | undefined): void {
  current = insights;
}

export async function getInsights(): Promise<Insights> {
  if (current) return current;
  const [{ readContactsAsUser }, { auditPages }, { readSpacePagesAsUser }, { getCheckService }] = await Promise.all([
    import('../actions/contacts'),
    import('../actions/auditSpace'),
    import('../actions/spaceReader'),
    import('../actions/service'),
  ]);
  current = {
    pageContacts: readContactsAsUser,
    auditSpace: async (spaceId) => auditPages(getCheckService, await readSpacePagesAsUser(spaceId), 'context'),
  };
  return current;
}
