/** Shared helpers for building Unknown and Contradicted results. Pure. */
import type { Claim, ClaimResult, Coverage, Evidence, IndexKind, ReasonCode, RepoIndex } from '../model';
import { unknownReasonText, unknownStatement, type UnknownReasonKey } from '../wording';
import { makeEvidence, toResult } from './evidence';

export interface MatchOptions {
  /** Hosts that count as "this service" for curl style claims. Lowercase, without scheme. */
  serviceHosts?: readonly string[];
}

export interface MatchContext {
  index: RepoIndex;
  options: MatchOptions;
}

export function coverageReason(coverage: Coverage): 'coverage_partial' | 'coverage_none' {
  return coverage === 'none' ? 'coverage_none' : 'coverage_partial';
}

/** Unknown result. Coverage reasons carry a coverage evidence entry so the card can explain itself. */
export function unknownResult(
  claim: Claim,
  ctx: MatchContext,
  reason: UnknownReasonKey & ReasonCode,
  kind?: IndexKind,
  extra: Evidence[] = [],
): ClaimResult {
  const evidence = [...extra];
  if (kind !== undefined && (reason === 'coverage_partial' || reason === 'coverage_none')) {
    evidence.push(makeEvidence(ctx.index, 'coverage', undefined, `coverage:${kind}`));
  }
  return toResult(claim, 'unknown', reason, unknownStatement({ reason: unknownReasonText(reason) }), evidence);
}

export function absenceEvidence(ctx: MatchContext, kind: IndexKind): Evidence {
  return makeEvidence(ctx.index, 'absence', undefined, `absence:${kind}`);
}
