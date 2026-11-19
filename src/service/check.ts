/**
 * Check service (PLAN.md 3.1, 5.2 to 5.4): the one pipeline behind the macro, byline, Rovo action and MCP tool.
 *
 * Every dependency is injected so resolvers and actions can call it and integration only wires in
 * Task A's extractor and Task B's index store. Failures return `{ ok: false }` with a reason code and never a
 * verdict: a check that could not run is never Verified.
 */
import { createHash } from 'node:crypto';
import type { AgentEnvelope, Claim, ClaimResult, ReasonCode, Report, ReportCounts, RepoIndex } from '../core/model';
import { buildAgentEnvelope, buildReport, matchClaims, MAX_CLAIMS, type MatchOptions } from '../core/match';
import { sanitizeUntrusted } from '../core/match/evidence';
import { unknownReasonText, unknownStatement, type UnknownReasonKey } from '../core/wording';

/** Which repository to check. Both fields optional: the loader falls back to the site settings. */
export interface RepoSelector {
  repoUrl?: string;
  ref?: string;
}

/** Why no index could be loaded. `indexing` and `no_repo` are not matcher reasons; callers map them to their own state. */
export type IndexLoadFailure = 'index_missing' | 'repo_not_found_or_private' | 'rate_limited' | 'tarball_too_large' | 'indexing' | 'no_repo';

export type IndexLoadResult =
  | {
      ok: true;
      index: RepoIndex;
      stale: boolean;
      /** Set when the index is old because the freshness check failed, for example `rate_limited`. */
      staleReason?: ReasonCode;
    }
  | { ok: false; reason: IndexLoadFailure; message?: string };

export interface IndexLoader {
  loadIndex(repo: RepoSelector): Promise<IndexLoadResult>;
}

export interface ExtractedClaims {
  claims: Claim[];
  truncated: boolean;
}

/** Task A's extractor, adapted: `extractClaims(adf)` and `extractClaimsFromText(text)`. */
export interface ClaimExtractor {
  /** Changes whenever extraction rules change, so cached reports are not reused across versions. */
  readonly version?: string;
  extractClaims(adf: unknown): ExtractedClaims;
  extractClaimsFromText(text: string): ExtractedClaims;
}

export interface PageContent {
  id: string;
  title: string;
  version: number;
  adf: unknown;
}

export type PageReadResult = { ok: true; page: PageContent } | { ok: false; reason: 'page_not_found' | 'forbidden' };

export interface PageReader {
  readPage(pageId: string): Promise<PageReadResult>;
}

export interface Clock {
  now(): Date;
}

export interface ReportCache {
  get(key: string): Promise<Report | undefined>;
  set(key: string, report: Report): Promise<void>;
}

export interface CountsStore {
  set(key: string, value: { counts: ReportCounts; checkedAt: string }): Promise<void>;
}

export interface CheckDeps {
  indexLoader: IndexLoader;
  extractor: ClaimExtractor;
  clock: Clock;
  /** Optional `report:{hash}` cache (PLAN.md 5.2). */
  reportCache?: ReportCache;
  /** Optional `counts:{contentId}:{version}` store read by the byline (PLAN.md 5.3). */
  countsStore?: CountsStore;
  /** Optional page reader, only needed by `checkPage`. */
  pageReader?: PageReader;
  matchOptions?: MatchOptions;
}

export type CheckError = {
  ok: false;
  error: ReasonCode | 'invalid_input' | 'page_not_found' | 'forbidden' | 'internal_error' | 'indexing' | 'no_repo';
  /** Fixed text from wording.ts or this file, never quoted data. */
  message: string;
};

export type CheckOutcome = { ok: true; report: Report; staleReason?: ReasonCode } | CheckError;

export type PageCheckOutcome = { ok: true; report: Report; envelope: AgentEnvelope; page: PageContent } | CheckError;

/** Largest ADF the service accepts (PLAN.md 5.2: the front-end request limit is 500 KB). */
export const MAX_ADF_BYTES = 400 * 1024;
export const MAX_CLAIM_TEXT_LENGTH = 300;

const INVALID_INPUT_MESSAGE = 'The input is missing or too large to check.';

function failure(error: CheckError['error'], message: string): CheckError {
  return { ok: false, error, message };
}

function isIndexReason(reason: string): reason is UnknownReasonKey {
  return ['index_missing', 'repo_not_found_or_private', 'rate_limited', 'tarball_too_large'].includes(reason);
}

const NOT_READY_TEXT: Record<'indexing' | 'no_repo', string> = {
  indexing: 'the repository index is still being built',
  no_repo: 'no repository is configured in the app settings',
};

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function loadIndex(
  deps: CheckDeps,
  repoRef: RepoSelector,
): Promise<{ ok: true; index: RepoIndex; stale: boolean; staleReason?: ReasonCode } | CheckError> {
  const loaded = await deps.indexLoader.loadIndex(repoRef);
  if (loaded.ok) return loaded;
  if (loaded.reason === 'indexing' || loaded.reason === 'no_repo') {
    return failure(loaded.reason, unknownStatement({ reason: NOT_READY_TEXT[loaded.reason] }));
  }
  const text = isIndexReason(loaded.reason) ? unknownReasonText(loaded.reason) : 'the repository could not be indexed';
  return failure(loaded.reason, unknownStatement({ reason: text }));
}

function runMatch(deps: CheckDeps, index: RepoIndex, stale: boolean, claims: Claim[], truncated: boolean): Report {
  const capped = claims.slice(0, MAX_CLAIMS);
  const results: ClaimResult[] = matchClaims(capped, index, deps.matchOptions);
  return buildReport({ index, results, stale, claimsTruncated: truncated || claims.length > MAX_CLAIMS });
}

/** Checks an ADF document (macro body or page body). */
export async function checkDocument(deps: CheckDeps, input: { adf: unknown; repoRef?: RepoSelector; contentId?: string; version?: number }): Promise<CheckOutcome> {
  let serialized: string;
  try {
    serialized = JSON.stringify(input.adf) ?? '';
  } catch {
    return failure('invalid_input', INVALID_INPUT_MESSAGE);
  }
  if (serialized === '' || serialized.length > MAX_ADF_BYTES) return failure('invalid_input', INVALID_INPUT_MESSAGE);

  const repoRef = input.repoRef ?? {};
  const loaded = await loadIndex(deps, repoRef);
  if (!loaded.ok) return loaded;
  const { index, stale, staleReason } = loaded;

  const cacheKey = `report:${sha256(
    [serialized, index.repo.sha, index.repo.indexedAt, deps.extractor.version ?? '', String(stale), JSON.stringify(deps.matchOptions ?? {})].join('\u0000'),
  ).slice(0, 32)}`;
  let report = deps.reportCache ? await deps.reportCache.get(cacheKey) : undefined;
  if (!report) {
    const extracted = deps.extractor.extractClaims(input.adf);
    report = runMatch(deps, index, stale, extracted.claims, extracted.truncated);
    if (deps.reportCache) await deps.reportCache.set(cacheKey, report);
  }
  await recordCounts(deps, report, input.contentId, input.version);
  return { ok: true, report, ...(staleReason !== undefined ? { staleReason } : {}) };
}

function looksLikeCommand(text: string): boolean {
  return text.split(/\s+/).some((token) => token.startsWith('-') || /[0-9_./:-]/.test(token));
}

/** Checks one claim, or the few claims found in a short piece of text. */
export async function checkClaim(deps: CheckDeps, input: { text: string; repoRef?: RepoSelector }): Promise<CheckOutcome> {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text === '' || text.length > MAX_CLAIM_TEXT_LENGTH) return failure('invalid_input', INVALID_INPUT_MESSAGE);

  let extracted = deps.extractor.extractClaimsFromText(text);
  if (extracted.claims.length === 0 && !/[`\r\n]/.test(text)) {
    // A bare command or route pasted without backticks: retry once, treating the whole input as inline code.
    // The input stays data; only the code span marker is added. Length was capped above.
    // Plain prose becomes a "cli" claim when wrapped, so a cli claim is kept only when it looks like a command:
    // a flag, or a token with a digit or one of - _ . / : in it. Other claim types (route, env, file) are kept.
    const retried = deps.extractor.extractClaimsFromText(`\`${text}\``);
    extracted = { ...retried, claims: retried.claims.filter((claim) => claim.normalized.type !== 'cli' || looksLikeCommand(text)) };
  }
  if (extracted.claims.length === 0) {
    return failure(
      'not_a_checkable_claim',
      unknownStatement({ reason: unknownReasonText('not_a_checkable_claim') }),
    );
  }
  const loaded = await loadIndex(deps, input.repoRef ?? {});
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    report: runMatch(deps, loaded.index, loaded.stale, extracted.claims, extracted.truncated),
    ...(loaded.staleReason !== undefined ? { staleReason: loaded.staleReason } : {}),
  };
}

/** Reads a page with the injected reader (the caller's permissions), then runs `checkDocument` on it. */
export async function checkPage(deps: CheckDeps, input: { pageId: string; repoRef?: RepoSelector }): Promise<PageCheckOutcome> {
  if (!deps.pageReader) return failure('internal_error', 'No page reader is configured.');
  if (!/^\d{1,20}$/.test(input.pageId)) return failure('invalid_input', INVALID_INPUT_MESSAGE);
  const read = await deps.pageReader.readPage(input.pageId);
  if (!read.ok) return failure(read.reason, read.reason === 'forbidden' ? 'The page cannot be read with the caller permissions.' : 'The page was not found.');
  const checked = await checkDocument(deps, {
    adf: read.page.adf,
    ...(input.repoRef ? { repoRef: input.repoRef } : {}),
    contentId: read.page.id,
    version: read.page.version,
  });
  if (!checked.ok) return checked;
  return {
    ok: true,
    report: checked.report,
    envelope: buildAgentEnvelope(checked.report, { id: read.page.id, title: sanitizeUntrusted(read.page.title), version: read.page.version }),
    page: read.page,
  };
}

async function recordCounts(deps: CheckDeps, report: Report, contentId: string | undefined, version: number | undefined): Promise<void> {
  if (!deps.countsStore || contentId === undefined || version === undefined) return;
  await deps.countsStore.set(`counts:${contentId}:${version}`, { counts: report.counts, checkedAt: deps.clock.now().toISOString() });
}
