/** package_version rules (PLAN.md 7.2). */
import type { Claim, ClaimResult, PackageEntry, PackageVersionClaim } from '../model';
import { contradictedGenericStatement, verifiedStatement } from '../wording';
import { describeClaim, makeEvidence, makeSuggestion, sanitizeUntrusted, toResult } from './evidence';
import { absenceEvidence, coverageReason, unknownResult, type MatchContext } from './results';
import { rangesIntersect, startsBelowDeclaredMinimum } from './semver';

function normalizeName(ecosystem: string, name: string): string {
  const lower = name.toLowerCase();
  return ecosystem === 'pypi' ? lower.replace(/[-_.]+/g, '-') : lower;
}

/** The declared version in the notation of its ecosystem, so the proposed text reads like the claim it replaces. */
const RUNTIME_LABEL: Record<string, string> = { node: 'Node.js', python: 'Python', go: 'Go' };

export function declaredAs(entry: PackageEntry): string | undefined {
  const range = entry.range.trim();
  // An unpinned dependency has no version to quote.
  if (range === '' || range === '*') return undefined;
  switch (entry.ecosystem) {
    case 'pypi':
      // requirements.txt and pyproject.toml carry the operator in the range ("==2.1", ">=1.2,<2").
      return /^[=<>~!]/.test(range) ? `${entry.name}${range}` : `${entry.name}==${range}`;
    case 'maven':
      return `${entry.name}:${range}`;
    case 'runtime':
      return `${RUNTIME_LABEL[entry.name] ?? entry.name} ${range}`;
    case 'npm':
    case 'go':
      return `${entry.name}@${range}`;
  }
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
  const outcomes = ordered.map((entry) => {
    const intersects = rangesIntersect(entry.range, n.range);
    const belowMinimum = intersects === true && n.ecosystem === 'runtime' && startsBelowDeclaredMinimum(entry.range, n.range, n.name);
    return { entry, intersects: belowMinimum ? false : intersects, belowMinimum };
  });
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

  const selected = outcomes[0];
  if (!selected) return unknownResult(claim, ctx, 'package_not_direct_dependency', 'packages');
  const { entry: first, belowMinimum } = selected;
  const declared = makeEvidence(index, 'nearest', first);
  const quoted = declaredAs(first);
  const declaredText = belowMinimum && quoted ? quoted : `${first.name}@${first.range}`;
  return toResult(
    claim,
    'contradicted',
    belowMinimum ? 'runtime_minimum_conflict' : 'package_range_conflict',
    contradictedGenericStatement({
      claim: belowMinimum
        ? `${RUNTIME_LABEL[n.name] ?? n.name} ${n.range} starts below the supported minimum`
        : `${text} does not match the declared version`,
      detail: `The manifest declares ${sanitizeUntrusted(declaredText)} at ${first.file}:${first.line}.`,
    }),
    [declared, absenceEvidence(ctx, 'packages')],
    quoted === undefined ? undefined : makeSuggestion([quoted], declared),
  );
}
