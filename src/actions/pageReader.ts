import api, { route } from '@forge/api';
import type { AgentError } from '../core/model';

/** A page read for a check. `title` and `adf` are untrusted page content. */
export interface PageContent {
  id: string;
  title: string;
  version: number;
  adf: unknown;
}

export type PageReadResult =
  | { ok: true; page: PageContent }
  | { ok: false; error: Extract<AgentError['error'], 'page_not_found' | 'forbidden' | 'rate_limited' | 'internal_error'> };

export type PageReader = (pageId: string) => Promise<PageReadResult>;

/** Bound on the page body we are willing to parse, to protect function memory. */
const MAX_BODY_CHARS = 2_000_000;

/** Structured log line. Ids, statuses and names only: never page text, titles or tokens. */
function log(fields: Record<string, string | number>): void {
  console.log(JSON.stringify(fields));
}

interface PageResponse {
  id?: unknown;
  title?: unknown;
  version?: { number?: unknown };
  body?: { atlas_doc_format?: { value?: unknown } };
}

/**
 * Reads a page as the invoking user, so Confluence enforces that user's view permission.
 * `pageId` has already been validated as digits only, so it is safe in the route.
 * Never logs page text.
 */
export const readPageAsUser: PageReader = async (pageId) => {
  let response;
  try {
    response = await api
      .asUser()
      .requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`, {
        headers: { Accept: 'application/json' },
      });
  } catch (error) {
    log({ evt: 'page_read_threw', pageId, name: error instanceof Error ? error.name : 'unknown' });
    return { ok: false, error: 'internal_error' };
  }
  log({ evt: 'page_read', pageId, status: response.status });
  if (response.status === 404) return { ok: false, error: 'page_not_found' };
  if (response.status === 401 || response.status === 403) return { ok: false, error: 'forbidden' };
  if (response.status === 429) return { ok: false, error: 'rate_limited' };
  if (!response.ok) return { ok: false, error: 'internal_error' };

  let json: PageResponse;
  try {
    json = (await response.json()) as PageResponse;
  } catch {
    return { ok: false, error: 'internal_error' };
  }
  const value = json.body?.atlas_doc_format?.value;
  if (typeof value !== 'string' || value.length > MAX_BODY_CHARS) return { ok: false, error: 'internal_error' };
  let adf: unknown;
  try {
    adf = JSON.parse(value);
  } catch {
    return { ok: false, error: 'internal_error' };
  }
  return {
    ok: true,
    page: {
      id: pageId,
      title: typeof json.title === 'string' ? json.title : '',
      version: typeof json.version?.number === 'number' ? json.version.number : 0,
      adf,
    },
  };
};
