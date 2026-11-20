import api, { route } from '@forge/api';
import type { AgentError } from '../core/model';
import type { PageContent } from './pageReader';

/** Pages read for one space audit. Small on purpose: one request, and the checks must fit one function run. */
export const MAX_AUDIT_PAGES = 25;

/** Per page body bound, to protect function memory. A larger page is listed as skipped. */
const MAX_BODY_CHARS = 400 * 1024;

export interface SpacePage extends Omit<PageContent, 'adf'> {
  /** Undefined when the body was missing, too large or not valid JSON. */
  adf?: unknown;
}

export type SpaceReadResult =
  | { ok: true; spaceId: string; pages: SpacePage[]; more: boolean }
  | { ok: false; error: Extract<AgentError['error'], 'page_not_found' | 'forbidden' | 'rate_limited' | 'internal_error'> };

/** Reads the most recently edited pages of the space that contains `pageId`. */
export type SpaceReader = (pageId: string) => Promise<SpaceReadResult>;

function log(fields: Record<string, string | number>): void {
  console.log(JSON.stringify(fields));
}

function failure(status: number): SpaceReadResult {
  if (status === 404) return { ok: false, error: 'page_not_found' };
  if (status === 401 || status === 403) return { ok: false, error: 'forbidden' };
  if (status === 429) return { ok: false, error: 'rate_limited' };
  return { ok: false, error: 'internal_error' };
}

interface ListedPage {
  id?: unknown;
  title?: unknown;
  version?: { number?: unknown };
  body?: { atlas_doc_format?: { value?: unknown } };
}

export function toSpacePage(raw: ListedPage): SpacePage | undefined {
  if (typeof raw.id !== 'string' || !/^\d{1,20}$/.test(raw.id)) return undefined;
  const page: SpacePage = {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    version: typeof raw.version?.number === 'number' ? raw.version.number : 0,
  };
  const value = raw.body?.atlas_doc_format?.value;
  if (typeof value === 'string' && value.length <= MAX_BODY_CHARS) {
    try {
      page.adf = JSON.parse(value);
    } catch {
      // listed as skipped
    }
  }
  return page;
}

/**
 * Both requests run as the invoking user, so Confluence returns only pages that user can view.
 * `pageId` is digits only (validated by the caller). Logs ids and statuses, never titles or text.
 */
export const readSpaceAsUser: SpaceReader = async (pageId) => {
  try {
    const first = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, { headers: { Accept: 'application/json' } });
    log({ evt: 'audit_page_read', pageId, status: first.status });
    if (!first.ok) return failure(first.status);
    const spaceId = ((await first.json()) as { spaceId?: unknown }).spaceId;
    if (typeof spaceId !== 'string' || !/^\d{1,20}$/.test(spaceId)) return { ok: false, error: 'internal_error' };

    const listed = await api
      .asUser()
      .requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/pages?status=current&sort=-modified-date&limit=${String(MAX_AUDIT_PAGES)}&body-format=atlas_doc_format`, {
        headers: { Accept: 'application/json' },
      });
    log({ evt: 'audit_space_read', spaceId, status: listed.status });
    if (!listed.ok) return failure(listed.status);
    const json = (await listed.json()) as { results?: unknown; _links?: { next?: unknown } };
    const results = Array.isArray(json.results) ? (json.results as ListedPage[]) : [];
    const pages = results.slice(0, MAX_AUDIT_PAGES).map(toSpacePage).filter((page): page is SpacePage => page !== undefined);
    return { ok: true, spaceId, pages, more: typeof json._links?.next === 'string' };
  } catch (error) {
    log({ evt: 'audit_read_threw', pageId, name: error instanceof Error ? error.name : 'unknown' });
    return { ok: false, error: 'internal_error' };
  }
};
