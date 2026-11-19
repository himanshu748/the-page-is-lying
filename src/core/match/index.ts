/** Matcher entry points: Claim + RepoIndex -> ClaimResult / Report / agent envelope. */
import type { Claim, ClaimResult, RepoIndex } from '../model';
import { matchCli } from './cli';
import { matchConfig } from './config';
import { matchEnv } from './env';
import { matchFile } from './file';
import { matchHttp } from './route';
import { matchPackage } from './package';
import type { MatchContext, MatchOptions } from './results';

export { matchCli } from './cli';
export { matchConfig } from './config';
export { matchEnv } from './env';
export { matchFile } from './file';
export { matchHttp } from './route';
export { matchPackage } from './package';
export { describeClaim, makeEvidence, permalink, sanitizeUntrusted } from './evidence';
export { rankConfigSiblings, rankEnv, rankMovedFiles, rankNames, rankRoutes } from './nearest';
export { rangesIntersect } from './semver';
export { buildAgentEnvelope, buildReport, MAX_CLAIMS } from './report';
export type { MatchContext, MatchOptions } from './results';

export function matchClaim(claim: Claim, index: RepoIndex, options: MatchOptions = {}): ClaimResult {
  const ctx: MatchContext = { index, options };
  const n = claim.normalized;
  switch (n.type) {
    case 'http_endpoint':
      return matchHttp(claim, n, ctx);
    case 'env_var':
      return matchEnv(claim, n, ctx);
    case 'cli':
      return matchCli(claim, n, ctx);
    case 'config_key':
      return matchConfig(claim, n, ctx);
    case 'file_path':
      return matchFile(claim, n, ctx);
    case 'package_version':
      return matchPackage(claim, n, ctx);
  }
}

export function matchClaims(claims: readonly Claim[], index: RepoIndex, options: MatchOptions = {}): ClaimResult[] {
  return claims.map((claim) => matchClaim(claim, index, options));
}
