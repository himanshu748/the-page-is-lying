/** package_version rules (PLAN.md 7.2). */
import type { Claim, ClaimResult, PackageEntry, PackageVersionClaim } from '../model';
import { contradictedGenericStatement, verifiedStatement } from '../wording';
import { describeClaim, makeEvidence, makeSuggestion, sanitizeUntrusted, toResult } from './evidence';
import { absenceEvidence, coverageReason, unknownResult, type MatchContext } from './results';
import { rangesIntersect } from './semver';

function normalizeName(ecosystem: string, name: string): string {
  const lower = name.toLowerCase();
  return ecosystem === 'pypi' ? lower.replace(/[-_.]+/g, '-') : lower;
}

export function matchPackage(claim: Claim, n: PackageVersionClaim, ctx: MatchContext): ClaimResult {
  const { index } = ctx;
  const wanted = normalizeName(n.ecosystem, n.name);
  const sameName = index.packages.filter(
    (entry) => entry.ecosystem === n.ecosystem && normalizeName(entry.ecosystem, entry.name) === wanted,
  );
  if (sameName.length === 0) {
    const anyInEcosystem = index.packages.some((entry) => entry.ecosystem === n.ecosystem);
    return unknownResult(claim, ctx, anyInEcosystem ? 'package_not_direct_dependency' : 'manifest_missing', 'packages');
  }

  // Prefer runtime dependencies over dev dependencies.
  const ordered = [...sameName].sort((a, b) => Number(a.dev) - Number(b.dev));
  const outcomes = ordered.map((entry) => ({ entry, intersects: rangesIntersect(entry.range, n.range) }));
  const hit = outcomes.find((o) => o.intersects === true);
  const text = describeClaim(n);
  if (hit) {
    return toResult(
      claim,
      'verified',
      'package_range_intersects',
      verifiedStatement({ claim: text, file: hit.entry.file, line: hit.entry.line }),
      [makeEvidence(index, 'match', hit.entry)],
    );
  }
  if (outcomes.some((o) => o.intersects === undefined)) return unknownResult(claim, ctx, 'dynamic_definition', 'packages');
  const coverage = index.coverage.packages;
  if (coverage !== 'complete') return unknownResult(claim, ctx, coverageReason(coverage), 'packages');

  const first: PackageEntry | undefined = ordered[0];
  if (!first) return unknownResult(claim, ctx, 'package_not_direct_dependency', 'packages');
  const declared = makeEvidence(index, 'nearest', first);
  return toResult(
    claim,
    'contradicted',
    'package_range_conflict',
    contradictedGenericStatement({
      claim: `${text} does not match the declared version`,
      detail: `The manifest declares ${sanitizeUntrusted(first.name)}@${sanitizeUntrusted(first.range)} at ${first.file}:${first.line}.`,
    }),
    [declared, absenceEvidence(ctx, 'packages')],
    makeSuggestion([`${first.name}@${first.range}`], declared),
  );
}
