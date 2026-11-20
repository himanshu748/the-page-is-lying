import api, { route } from '@forge/api';

/**
 * "Who to ask" for a page: its owner, its last editor and its creator, read as the invoking user with the
 * scopes the app already has (`read:page:confluence`, `read:confluence-user`). Best effort: any failure
 * yields an empty list and never blocks a check.
 */
export type ContactRole = 'owner' | 'last_editor' | 'creator';

export interface PageContact {
  role: ContactRole;
  accountId: string;
  /** Profile name as Confluence returns it for this viewer. Rendered as text only. */
  displayName: string;
}

export type ContactsReader = (pageId: string) => Promise<PageContact[]>;

const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_NAME = 80;

interface PagePeople {
  ownerId?: unknown;
  authorId?: unknown;
  version?: { authorId?: unknown };
}

/** Owner first, then last editor, then creator. One entry per person: the first role wins. */
export function contactIds(page: PagePeople): { role: ContactRole; accountId: string }[] {
  const ordered: [ContactRole, unknown][] = [
    ['owner', page.ownerId],
    ['last_editor', page.version?.authorId],
    ['creator', page.authorId],
  ];
  const seen = new Set<string>();
  const out: { role: ContactRole; accountId: string }[] = [];
  for (const [role, id] of ordered) {
    if (typeof id !== 'string' || !ACCOUNT_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ role, accountId: id });
  }
  return out;
}

export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Array.from(value)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

export const readContactsAsUser: ContactsReader = async (pageId) => {
  try {
    const response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const ids = contactIds((await response.json()) as PagePeople);
    const contacts: PageContact[] = [];
    for (const { role, accountId } of ids) {
      const user = await api.asUser().requestConfluence(route`/wiki/rest/api/user?accountId=${accountId}`, { headers: { Accept: 'application/json' } });
      if (!user.ok) continue;
      const json = (await user.json()) as { displayName?: unknown; publicName?: unknown; accountType?: unknown };
      // Apps and deactivated accounts are not people to ask.
      if (json.accountType !== undefined && json.accountType !== 'atlassian') continue;
      const displayName = cleanName(json.displayName) || cleanName(json.publicName);
      if (displayName !== '') contacts.push({ role, accountId, displayName });
    }
    console.log(JSON.stringify({ evt: 'contacts_read', pageId, found: contacts.length }));
    return contacts;
  } catch (error) {
    console.log(JSON.stringify({ evt: 'contacts_read_threw', pageId, name: error instanceof Error ? error.name : 'unknown' }));
    return [];
  }
};
