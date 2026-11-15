/**
 * Input validation for the read-only Rovo actions (PLAN.md 5.4 and 11).
 *
 * Trust order: values in `payload.context` come from Atlassian and are deterministic.
 * Values in the action inputs come from the LLM or an MCP client and may be wrong or hostile,
 * so they are only used when there is no context, and only after format and length checks.
 */

export const MAX_CLAIM_LENGTH = 300;
export const MAX_PAGE_INPUT_LENGTH = 500;
const MAX_PAGE_ID_DIGITS = 19;

export type PageIdSource = 'context' | 'input';

export interface ActionContext {
  cloudId?: unknown;
  moduleKey?: unknown;
  confluence?: { contentId?: unknown; url?: unknown; resourceType?: unknown } | undefined;
}

export type InputFailure = { ok: false; error: 'invalid_input'; detail: InputProblem };

export type InputProblem =
  | 'claim_missing'
  | 'claim_too_long'
  | 'claim_empty'
  | 'page_not_a_page_reference'
  | 'page_too_long'
  | 'page_host_not_allowed'
  | 'page_missing';

export type PageIdResult = { ok: true; id: string; source: PageIdSource } | InputFailure;
export type OptionalPageIdResult = { ok: true; id: string | null; source: PageIdSource | null } | InputFailure;
export type ClaimResultInput = { ok: true; claim: string } | InputFailure;

/** Characters that must never reach a log, a URL or the model: C0/C1 controls, bidi overrides, zero-width marks. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** Strip control characters, replace line breaks with spaces and trim. */
export function stripControl(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ').replace(UNSAFE_CHARS, '').trim();
}

/** Strip control characters and cut to `max` characters, marking the cut with an ellipsis. */
export function clean(text: string, max: number): string {
  const stripped = stripControl(text);
  if (stripped.length <= max) return stripped;
  return `${stripped.slice(0, Math.max(0, max - 1))}\u2026`;
}

function isPageIdString(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value) && value.length <= MAX_PAGE_ID_DIGITS;
}

function asNumericId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && isPageIdString(value.trim())) return value.trim();
  return null;
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The page id a Confluence page URL points at, or null. Handles /pages/<id>/... and viewpage.action?pageId=<id>. */
function pageIdFromUrl(url: URL): string | null {
  const fromPath = /\/pages\/([0-9]{1,19})(?:\/|$)/.exec(url.pathname);
  if (fromPath?.[1] !== undefined && isPageIdString(fromPath[1])) return fromPath[1];
  if (/\/viewpage\.action$/.test(url.pathname)) {
    const q = url.searchParams.get('pageId');
    if (q !== null && isPageIdString(q)) return q;
  }
  return null;
}

/**
 * Parse an LLM-provided page reference: a numeric id, or an https Confluence URL.
 *
 * The id is read from the site where the app is installed, so a URL's host cannot redirect the read
 * anywhere else. We still reject hosts that are not Atlassian Cloud sites, and, when the payload
 * carries the site URL, hosts other than that site, so a wrong-site URL fails loudly instead of
 * silently reading a page with the same id on this site.
 */
export function parsePageReference(raw: string, siteUrl?: string): PageIdResult {
  const text = stripControl(raw);
  if (text.length === 0) return { ok: false, error: 'invalid_input', detail: 'page_missing' };
  if (text.length > MAX_PAGE_INPUT_LENGTH) return { ok: false, error: 'invalid_input', detail: 'page_too_long' };
  if (isPageIdString(text)) return { ok: true, id: text, source: 'input' };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'invalid_input', detail: 'page_not_a_page_reference' };
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return { ok: false, error: 'invalid_input', detail: 'page_not_a_page_reference' };
  }
  const host = url.hostname.toLowerCase();
  const contextHost = siteUrl === undefined ? null : hostOf(siteUrl);
  const hostAllowed = contextHost !== null ? host === contextHost : /^[a-z0-9-]+\.atlassian\.net$/.test(host);
  if (!hostAllowed) return { ok: false, error: 'invalid_input', detail: 'page_host_not_allowed' };
  const id = pageIdFromUrl(url);
  if (id === null) return { ok: false, error: 'invalid_input', detail: 'page_not_a_page_reference' };
  return { ok: true, id, source: 'input' };
}

/** Page id from the Atlassian-provided context first, then from validated input. */
export function resolvePageId(
  input: unknown,
  context: ActionContext | undefined,
  options: { required: boolean },
): OptionalPageIdResult {
  const fromContext = asNumericId(context?.confluence?.contentId);
  if (fromContext !== null) return { ok: true, id: fromContext, source: 'context' };

  if (input === undefined || input === null || (typeof input === 'string' && input.trim() === '')) {
    return options.required
      ? { ok: false, error: 'invalid_input', detail: 'page_missing' }
      : { ok: true, id: null, source: null };
  }
  if (typeof input === 'number') {
    const id = asNumericId(input);
    return id === null
      ? { ok: false, error: 'invalid_input', detail: 'page_not_a_page_reference' }
      : { ok: true, id, source: 'input' };
  }
  if (typeof input !== 'string') return { ok: false, error: 'invalid_input', detail: 'page_not_a_page_reference' };
  const siteUrl = typeof context?.confluence?.url === 'string' ? context.confluence.url : undefined;
  return parsePageReference(input, siteUrl);
}

/** Claim text: a string of 1 to 300 characters after control characters are stripped. */
export function validateClaim(input: unknown): ClaimResultInput {
  if (typeof input !== 'string') return { ok: false, error: 'invalid_input', detail: 'claim_missing' };
  if (input.length > MAX_CLAIM_LENGTH * 4) return { ok: false, error: 'invalid_input', detail: 'claim_too_long' };
  const claim = stripControl(input);
  if (claim.length === 0) return { ok: false, error: 'invalid_input', detail: 'claim_empty' };
  if (claim.length > MAX_CLAIM_LENGTH) return { ok: false, error: 'invalid_input', detail: 'claim_too_long' };
  return { ok: true, claim };
}
