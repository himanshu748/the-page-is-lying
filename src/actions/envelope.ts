import type {
  AgentError,
  AgentEnvelope,
  AgentEvidence,
  AgentResult,
  ClaimResult,
  Evidence,
  ReasonCode,
  Report,
  ReportCounts,
  ReportLimits,
  Verdict,
} from '../core/model';
import { AGENT_DATA_NOTICE } from '../core/wording';
import type { PageIdSource } from './input';
import { clean } from './input';

/** Hard caps that keep the envelope far below the 5 MB action limit (PLAN.md 9.2). */
export const LIMITS = {
  results: 200,
  evidencePerResult: 4,
  claimText: 300,
  snippet: 160,
  title: 200,
  statement: 600,
  path: 300,
  permalink: 600,
  id: 64,
} as const;

/** The envelope as the actions return it: `page.source` tells the agent where the page id came from. */
export type ActionEnvelope = Omit<AgentEnvelope, 'page'> & {
  page?: NonNullable<AgentEnvelope['page']> & { source: PageIdSource };
};

export interface PageInfo {
  id: string;
  title: string;
  version: number;
  source: PageIdSource;
}

const VERDICTS: readonly Verdict[] = ['verified', 'contradicted', 'unknown'];

function safeId(value: unknown): string {
  return typeof value === 'string' ? clean(value, LIMITS.id).replace(/[^A-Za-z0-9_:.-]/g, '') : '';
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function onlyGithubOrBitbucketUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    const ok = parsed.protocol === 'https:' && ['github.com', 'bitbucket.org'].includes(parsed.hostname);
    return ok ? clean(parsed.toString(), LIMITS.permalink) : undefined;
  } catch {
    return undefined;
  }
}

/** Copies only whitelisted fields, so nothing else on the report (settings, tokens) can leak. */
function toAgentEvidence(evidence: Evidence): AgentEvidence {
  const out: AgentEvidence = { id: safeId(evidence.id), kind: evidence.kind };
  if (typeof evidence.file === 'string') out.file = clean(evidence.file, LIMITS.path);
  if (typeof evidence.line === 'number' && Number.isInteger(evidence.line) && evidence.line > 0) out.line = evidence.line;
  const permalink = onlyGithubOrBitbucketUrl(evidence.permalink);
  if (permalink !== undefined) out.permalink = permalink;
  if (typeof evidence.snippet === 'string') out.untrustedSnippet = clean(evidence.snippet, LIMITS.snippet);
  return out;
}

function toAgentResult(result: ClaimResult): AgentResult {
  // The verdict is whatever the deterministic matcher decided. A value outside the enum can only be a
  // bug, and it is reported as "no evidence found", never as a pass.
  const verdict: Verdict = VERDICTS.includes(result.verdict) ? result.verdict : 'unknown';
  return {
    claimId: safeId(result.claim.id),
    type: result.claim.type,
    verdict,
    statement: clean(result.statement, LIMITS.statement),
    untrustedClaimText: clean(result.claim.raw, LIMITS.claimText),
    evidence: result.evidence.slice(0, LIMITS.evidencePerResult).map(toAgentEvidence),
  };
}

function toCounts(counts: ReportCounts): ReportCounts {
  return {
    claims: safeCount(counts.claims),
    verified: safeCount(counts.verified),
    contradicted: safeCount(counts.contradicted),
    unknown: safeCount(counts.unknown),
  };
}

function toLimits(limits: ReportLimits): ReportLimits {
  const c = limits.coverage;
  return {
    maxClaims: safeCount(limits.maxClaims),
    claimsTruncated: limits.claimsTruncated === true,
    filesIndexed: safeCount(limits.filesIndexed),
    filesSkipped: safeCount(limits.filesSkipped),
    indexTruncated: limits.indexTruncated === true,
    coverage: { routes: c.routes, env: c.env, cli: c.cli, config: c.config, files: c.files, packages: c.packages },
  };
}

/** Build the `pil.agent.v1` envelope from a report. Repo and page text appear only in `untrusted*` fields. */
export function buildEnvelope(report: Report, page?: PageInfo): ActionEnvelope {
  const envelope: ActionEnvelope = {
    schema: 'pil.agent.v1',
    dataNotice: AGENT_DATA_NOTICE,
    repo: {
      fullName: clean(report.repo.fullName, 140),
      ref: clean(report.repo.ref, 140),
      sha: safeId(report.repo.sha),
      indexedAt: clean(report.repo.indexedAt, 40),
      stale: report.stale === true,
    },
    counts: toCounts(report.counts),
    limits: toLimits(report.limits),
    results: report.results.slice(0, LIMITS.results).map(toAgentResult),
  };
  if (page !== undefined) {
    envelope.page = {
      id: page.id,
      untrustedTitle: clean(page.title, LIMITS.title),
      version: safeCount(page.version),
      source: page.source,
    };
  }
  return envelope;
}

/** What each failure reason tells the user. Fixed text: nothing from the page or the input is echoed. */
const ERROR_MESSAGES: Partial<Record<AgentError['error'], string>> = {
  invalid_input: 'The input was not valid, so nothing was checked. No verdict was produced.',
  page_not_found: 'The page was not found or is not visible to the current user. No verdict was produced.',
  forbidden: 'The current user is not allowed to view this page. No verdict was produced.',
  internal_error: 'The check failed unexpectedly. No verdict was produced.',
  index_missing: 'No repository index is available yet. Configure a repository in the app settings and wait for indexing. No verdict was produced.',
  repo_not_found_or_private: 'The configured repository was not found or is private. No verdict was produced.',
  rate_limited: 'The code host or Atlassian rate-limited the request. Try again later. No verdict was produced.',
  tarball_too_large: 'The repository is too large to index. No verdict was produced.',
  not_a_checkable_claim: 'The text does not contain a claim this app can check (endpoint, env var, CLI command or flag, config key, file path or package version). No verdict was produced.',
};

const FALLBACK_MESSAGE = 'The check could not run. No verdict was produced.';

export function buildError(error: AgentError['error'], detail?: string): AgentError & { detail?: string } {
  const base: AgentError = {
    schema: 'pil.agent.error.v1',
    error,
    message: ERROR_MESSAGES[error] ?? FALLBACK_MESSAGE,
  };
  return detail === undefined ? base : { ...base, detail };
}

/** Failure reasons the service may return that do not describe a verdict. */
export function errorFromReason(reason: ReasonCode): AgentError {
  return buildError(reason);
}
