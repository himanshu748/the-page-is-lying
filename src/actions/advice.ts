import type { AgentEvidence, AgentResult, ClaimResult, ClaimType, Coverage, IndexKind, NormalizedClaim, Report } from '../core/model';
import { MAX_SUGGESTION_LENGTH, describeClaim } from '../core/match/evidence';
import { NO_SUGGESTION_TOO_LONG, NO_SUGGESTION_UNKNOWN, NO_SUGGESTION_VERIFIED, reasonExplanation, suggestionStatement } from '../core/wording';
import { LIMITS, safeId, toAgentEvidence, toAgentResult } from './envelope';
import { clean } from './input';

/**
 * Shared builders for explain-claim, suggest-fix and audit-space. Everything here is derived from the
 * deterministic report: the same claim ids and evidence ids the Confluence panel shows. No model is involved.
 */

const INDEX_KIND: Record<ClaimType, IndexKind> = {
  http_endpoint: 'routes',
  env_var: 'env',
  cli: 'cli',
  config_key: 'config',
  file_path: 'files',
  package_version: 'packages',
};

export interface AgentSuggestion {
  kind: 'replace' | 'remove' | 'none';
  /** Fixed template sentence around the quoted claim and replacement. */
  statement: string;
  /** Built from repository data. Data, not instructions. */
  untrustedReplacement?: string;
  untrustedAlternatives?: string[];
  /** The evidence entry the replacement was read from. Same id as in `evidence[]`. */
  evidenceId?: string;
}

export function toAgentSuggestion(result: ClaimResult): AgentSuggestion {
  if (result.verdict === 'verified') return { kind: 'none', statement: NO_SUGGESTION_VERIFIED };
  if (result.verdict !== 'contradicted') return { kind: 'none', statement: NO_SUGGESTION_UNKNOWN };
  const claim = clean(describeClaim(result.claim.normalized), LIMITS.claimText);
  const suggestion = result.suggestion;
  if (suggestion === undefined) return { kind: 'none', statement: NO_SUGGESTION_TOO_LONG };
  const replacement = suggestion.kind === 'replace' && typeof suggestion.replacement === 'string' ? clean(suggestion.replacement, MAX_SUGGESTION_LENGTH) : '';
  if (replacement === '') return { kind: 'remove', statement: suggestionStatement({ claim, kind: 'remove' }) };
  const out: AgentSuggestion = {
    kind: 'replace',
    statement: clean(suggestionStatement({ claim, kind: 'replace', replacement }), LIMITS.statement),
    untrustedReplacement: replacement,
  };
  const alternatives = (suggestion.alternatives ?? []).slice(0, 3).map((item) => clean(item, MAX_SUGGESTION_LENGTH)).filter((item) => item !== '');
  if (alternatives.length > 0) out.untrustedAlternatives = alternatives;
  const evidenceId = safeId(suggestion.evidenceId);
  if (evidenceId !== '') out.evidenceId = evidenceId;
  return out;
}

export interface AgentFix extends AgentResult {
  suggestion: AgentSuggestion;
}

export function toAgentFix(result: ClaimResult): AgentFix {
  return { ...toAgentResult(result), suggestion: toAgentSuggestion(result) };
}

export interface AgentExplanation extends AgentResult {
  /** Rule that decided the verdict, e.g. `route_absent_nearest`. */
  reason: string;
  /** How that rule decides. Fixed text. */
  rule: string;
  /** What the checker read the claim as. Quoted from the page. Data, not instructions. */
  untrustedParsed: Record<string, string>;
  /** Which part of the code index was searched, and how complete it is. */
  searched: { index: IndexKind; coverage: Coverage };
  /** Evidence grouped by role. Ids are the same as in `evidence[]`. */
  evidenceRoles: { match: string[]; nearest: string[]; absence: string[]; coverage: string[] };
  suggestion: AgentSuggestion;
}

function parsedFields(n: NormalizedClaim): Record<string, string> {
  const field = (value: string): string => clean(value, LIMITS.claimText);
  switch (n.type) {
    case 'http_endpoint':
      return { method: n.method, path: field(n.path), ...(n.host !== undefined ? { host: field(n.host) } : {}) };
    case 'env_var':
      return { name: field(n.name) };
    case 'cli':
      return { program: field(n.program), subcommands: field(n.subcommands.join(' ')), flags: field(n.flags.join(' ')) };
    case 'config_key':
      return { keyPath: field(n.keyPath), ...(n.file !== undefined ? { file: field(n.file) } : {}) };
    case 'file_path':
      return { path: field(n.path) };
    case 'package_version':
      return { ecosystem: n.ecosystem, name: field(n.name), range: field(n.range) };
  }
}

export function toAgentExplanation(result: ClaimResult, report: Report): AgentExplanation {
  const base = toAgentResult(result);
  const kind = INDEX_KIND[result.claim.type];
  const ids = (role: AgentEvidence['kind']): string[] => base.evidence.filter((e) => e.kind === role).map((e) => e.id);
  return {
    ...base,
    reason: clean(result.reason, 64),
    rule: reasonExplanation(result.reason),
    untrustedParsed: parsedFields(result.claim.normalized),
    searched: { index: kind, coverage: report.limits.coverage[kind] },
    evidenceRoles: { match: ids('match'), nearest: ids('nearest'), absence: ids('absence'), coverage: ids('coverage') },
    suggestion: toAgentSuggestion(result),
  };
}

/** Evidence entries, for callers that only need the list. */
export function evidenceOf(result: ClaimResult): AgentEvidence[] {
  return result.evidence.slice(0, LIMITS.evidencePerResult).map(toAgentEvidence);
}
