/** file_path rules (PLAN.md 7.2). */
import type { Claim, ClaimResult, FilePathClaim } from '../model';
import { alternativesDetail, contradictedGenericStatement, verifiedFileStatement } from '../wording';
import { describeClaim, makeEvidence, makeSuggestion, toResult } from './evidence';
import { rankMovedFiles } from './nearest';
import { absenceEvidence, coverageReason, unknownResult, type MatchContext } from './results';

export function matchFile(claim: Claim, n: FilePathClaim, ctx: MatchContext): ClaimResult {
  const { index } = ctx;
  const path = n.path.replace(/^\.?\//, '');
  const isDirectory = path.endsWith('/');
  const hit = isDirectory
    ? index.files.find((file) => file.path.startsWith(path))
    : index.files.find((file) => file.path === path);
  const text = describeClaim(n);
  if (hit) {
    const file = isDirectory ? path : hit.path;
    return toResult(claim, 'verified', 'file_present', verifiedFileStatement({ claim: text, file }), [
      makeEvidence(index, 'match', { file: hit.path }),
    ]);
  }

  if (index.stats.truncated) return unknownResult(claim, ctx, 'tree_truncated', 'files');
  const coverage = index.coverage.files;
  if (coverage !== 'complete') return unknownResult(claim, ctx, coverageReason(coverage), 'files');

  const near = rankMovedFiles(path, index.files);
  const evidence = near.files.map((file) => makeEvidence(index, 'nearest', { file: file.path }));
  evidence.push(absenceEvidence(ctx, 'files'));
  return toResult(
    claim,
    'contradicted',
    'file_absent',
    contradictedGenericStatement({
      claim: `${text} is not in the repository`,
      detail:
        near.files.length === 0
          ? 'No file with a similar name or directory was found.'
          : alternativesDetail({
              label: near.moved ? 'A file with the same name exists at' : 'The nearest directory contains',
              items: near.files.map((file) => file.path),
            }),
    }),
    evidence,
    // Only a file with the same name elsewhere is a counterpart. Neighbours in the nearest directory are not.
    makeSuggestion(near.moved ? near.files.map((file) => file.path) : [], near.moved ? evidence[0] : undefined),
  );
}
