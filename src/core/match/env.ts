/** env_var rules (PLAN.md 7.2). */
import type { Claim, ClaimResult, EnvEntry, EnvVarClaim } from '../model';
import { contradictedEnvStatement, verifiedStatement } from '../wording';
import { makeEvidence, makeSuggestion, toResult } from './evidence';
import { rankEnv } from './nearest';
import { absenceEvidence, coverageReason, unknownResult, type MatchContext } from './results';

export function matchEnv(claim: Claim, n: EnvVarClaim, ctx: MatchContext): ClaimResult {
  const { index } = ctx;
  const hits = index.env.filter((entry) => entry.name === n.name);
  const hit: EnvEntry | undefined = hits.find((entry) => entry.source === 'code') ?? hits[0];
  if (hit) {
    return toResult(
      claim,
      'verified',
      hit.source === 'code' ? 'env_read_in_code' : 'env_listed_in_config',
      verifiedStatement({ claim: n.name, file: hit.file, line: hit.line }),
      [makeEvidence(index, 'match', hit)],
    );
  }

  const coverage = index.coverage.env;
  if (coverage !== 'complete') return unknownResult(claim, ctx, coverageReason(coverage), 'env');
  // A complete index needs at least one static read. Zero entries means the builder saw nothing.
  if (!index.env.some((entry) => entry.source === 'code')) return unknownResult(claim, ctx, 'coverage_none', 'env');

  const nearest = rankEnv(n.name, index.env);
  const top = nearest[0];
  const evidence = nearest.map((entry) => makeEvidence(index, 'nearest', entry));
  evidence.push(absenceEvidence(ctx, 'env'));
  return toResult(
    claim,
    'contradicted',
    'env_not_read',
    contradictedEnvStatement({
      name: n.name,
      repo: index.repo.fullName,
      sha: index.repo.sha,
      ...(top ? { nearest: { name: top.name, file: top.file, line: top.line } } : {}),
    }),
    evidence,
    makeSuggestion(nearest.map((entry) => entry.name), top ? evidence[0] : undefined),
  );
}
