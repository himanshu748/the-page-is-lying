/** http_endpoint rules (PLAN.md 7.2). */
import type { Claim, ClaimResult, HttpEndpointClaim, RouteEntry } from '../model';
import {
  contradictedRouteStatement,
  contradictedGenericStatement,
  verifiedStatement,
} from '../wording';
import { describeClaim, makeEvidence, makeSuggestion, toResult } from './evidence';
import { methodMatches, pathSegments, rankRoutes, segmentsMatch } from './nearest';
import { absenceEvidence, coverageReason, unknownResult, type MatchContext } from './results';

function routeText(route: RouteEntry): string {
  return route.method === 'ANY' ? route.path : `${route.method} ${route.path}`;
}

/** A declared catch-all can verify a claim about that exact pattern. */
function isSpecificEvidence(routePath: string, claimedPath: string): boolean {
  return routePath === claimedPath || !pathSegments(routePath).includes('*');
}

export function matchHttp(claim: Claim, n: HttpEndpointClaim, ctx: MatchContext): ClaimResult {
  const { index } = ctx;
  const text = describeClaim(n);

  if (n.host !== undefined && n.host !== '') {
    const hosts = (ctx.options.serviceHosts ?? []).map((host) => host.toLowerCase());
    if (!hosts.includes(n.host.toLowerCase())) return unknownResult(claim, ctx, 'external_host');
  }

  const claimSegments = pathSegments(n.path);
  const matching = index.routes.filter(
    (route) => methodMatches(n.method, route.method) && segmentsMatch(claimSegments, pathSegments(route.path)),
  );
  const specific = matching.filter((route) => isSpecificEvidence(route.path, n.path));
  const hit = specific.find((route) => route.method === n.method) ?? specific[0];
  if (hit) {
    return toResult(
      claim,
      'verified',
      n.method === 'ANY' ? 'route_any_method' : 'route_exact',
      verifiedStatement({ claim: text, file: hit.file, line: hit.line }),
      [makeEvidence(index, 'match', hit)],
    );
  }
  const catchAll = matching[0];
  if (catchAll) return unknownResult(claim, ctx, 'route_wildcard_only', undefined, [makeEvidence(index, 'nearest', catchAll)]);

  const coverage = index.coverage.routes;
  if (coverage !== 'complete') return unknownResult(claim, ctx, coverageReason(coverage), 'routes');

  const nearest = rankRoutes(n, index.routes.filter((route) => isSpecificEvidence(route.path, n.path)));
  const top = nearest[0];
  const evidence = nearest.map((route) => makeEvidence(index, 'nearest', route));
  evidence.push(absenceEvidence(ctx, 'routes'));
  if (!top) {
    return toResult(
      claim,
      'contradicted',
      'route_absent',
      contradictedGenericStatement({ claim: `no route matches ${text}`, detail: `The repo defines no similar route.` }),
      evidence,
      makeSuggestion([]),
    );
  }
  return toResult(
    claim,
    'contradicted',
    'route_absent_nearest',
    contradictedRouteStatement({ claim: text, nearest: { text: routeText(top), file: top.file, line: top.line } }),
    evidence,
    makeSuggestion(nearest.map(routeText), evidence[0]),
  );
}
