/** Report (pil.report.v1) and agent envelope (pil.agent.v1) builders. Pure. */
import type {
  AgentEnvelope,
  AgentEvidence,
  AgentResult,
  ClaimResult,
  Evidence,
  Report,
  ReportCounts,
  RepoIndex,
} from '../model';
import { AGENT_DATA_NOTICE } from '../wording';
import { sanitizeUntrusted } from './evidence';

export const MAX_CLAIMS = 200;

export function countResults(results: readonly ClaimResult[]): ReportCounts {
  const counts: ReportCounts = { claims: results.length, verified: 0, contradicted: 0, unknown: 0 };
  for (const result of results) counts[result.verdict]++;
  return counts;
}

export function buildReport(args: {
  index: RepoIndex;
  results: readonly ClaimResult[];
  stale?: boolean;
  claimsTruncated?: boolean;
  maxClaims?: number;
}): Report {
  const { index } = args;
  const maxClaims = args.maxClaims ?? MAX_CLAIMS;
  const capped = args.results.slice(0, maxClaims);
  return {
    schema: 'pil.report.v1',
    repo: { ...index.repo },
    stale: args.stale ?? false,
    counts: countResults(capped),
    limits: {
      maxClaims,
      claimsTruncated: (args.claimsTruncated ?? false) || args.results.length > maxClaims,
      filesIndexed: index.stats.filesIndexed,
      filesSkipped: index.stats.filesSkipped,
      indexTruncated: index.stats.truncated,
      coverage: { ...index.coverage },
    },
    results: capped,
  };
}

function toAgentEvidence(evidence: Evidence): AgentEvidence {
  const out: AgentEvidence = { id: evidence.id, kind: evidence.kind };
  if (evidence.file !== undefined) out.file = evidence.file;
  if (evidence.line !== undefined) out.line = evidence.line;
  if (evidence.permalink !== undefined) out.permalink = evidence.permalink;
  if (evidence.snippet !== undefined) out.untrustedSnippet = sanitizeUntrusted(evidence.snippet);
  return out;
}

function toAgentResult(result: ClaimResult): AgentResult {
  return {
    claimId: result.claim.id,
    type: result.claim.type,
    verdict: result.verdict,
    statement: result.statement,
    untrustedClaimText: sanitizeUntrusted(result.claim.raw),
    evidence: result.evidence.map(toAgentEvidence),
  };
}

export function buildAgentEnvelope(report: Report, page?: { id: string; title: string; version: number }): AgentEnvelope {
  const envelope: AgentEnvelope = {
    schema: 'pil.agent.v1',
    dataNotice: AGENT_DATA_NOTICE,
    repo: {
      fullName: report.repo.fullName,
      ref: report.repo.ref,
      sha: report.repo.sha,
      indexedAt: report.repo.indexedAt,
      stale: report.stale,
    },
    counts: { ...report.counts },
    limits: { ...report.limits, coverage: { ...report.limits.coverage } },
    results: report.results.map(toAgentResult),
  };
  if (page) envelope.page = { id: page.id, untrustedTitle: sanitizeUntrusted(page.title), version: page.version };
  return envelope;
}
