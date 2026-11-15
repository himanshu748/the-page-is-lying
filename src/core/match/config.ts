/** config_key rules (PLAN.md 7.2). */
import type { Claim, ClaimResult, ConfigKeyClaim } from '../model';
import { alternativesDetail, contradictedGenericStatement, verifiedStatement } from '../wording';
import { describeClaim, makeEvidence, toResult } from './evidence';
import { rankConfigSiblings } from './nearest';
import { absenceEvidence, coverageReason, unknownResult, type MatchContext } from './results';

function normalizeFile(file: string): string {
  return file.replace(/^\.?\//, '');
}

/** A file named in a claim matches a parsed file by full path, or by basename when the claim names no directory. */
function sameFile(claimFile: string, parsed: string): boolean {
  const a = normalizeFile(claimFile);
  const b = normalizeFile(parsed);
  if (a === b) return true;
  return !a.includes('/') && b.endsWith(`/${a}`);
}

export function matchConfig(claim: Claim, n: ConfigKeyClaim, ctx: MatchContext): ClaimResult {
  const { index } = ctx;
  const claimFile = n.file;
  const scoped = claimFile === undefined ? index.config : index.config.filter((entry) => sameFile(claimFile, entry.file));
  const hit = scoped.find((entry) => entry.keyPath === n.keyPath);
  const text = describeClaim(n);
  if (hit) {
    return toResult(claim, 'verified', 'config_key_present', verifiedStatement({ claim: text, file: hit.file, line: hit.line }), [
      makeEvidence(index, 'match', hit),
    ]);
  }

  if (claimFile !== undefined) {
    const known = index.configFiles.some((file) => sameFile(claimFile, file));
    if (!known) return unknownResult(claim, ctx, 'config_file_not_in_repo', 'config');
  } else if (index.configFiles.length === 0) {
    return unknownResult(claim, ctx, 'no_config_files', 'config');
  }

  const coverage = index.coverage.config;
  if (coverage !== 'complete') return unknownResult(claim, ctx, coverageReason(coverage), 'config');

  const siblings = rankConfigSiblings(n.keyPath, scoped);
  const top = siblings[0];
  const evidence = siblings.map((entry) => makeEvidence(index, 'nearest', entry));
  evidence.push(absenceEvidence(ctx, 'config'));
  return toResult(
    claim,
    'contradicted',
    'config_key_absent',
    contradictedGenericStatement({
      claim: `${n.keyPath} is not defined${claimFile === undefined ? '' : ` in ${claimFile}`}`,
      detail: alternativesDetail({
        label: 'The config defines',
        items: siblings.map((entry) => entry.keyPath),
        ...(top ? { file: top.file, line: top.line } : {}),
      }),
    }),
    evidence,
  );
}
