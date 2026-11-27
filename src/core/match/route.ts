/** http_endpoint rules (PLAN.md 7.2). */
import type { Claim, ClaimResult, HttpEndpointClaim, RouteEntry } from '../model';
import { catchAllMinimumSegments } from '../route-path';
import {
  contradictedRouteStatement,
  contradictedGenericStatement,
  verifiedImplicitHeadStatement,
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
  return routePath === claimedPath || !pathSegments(routePath).some((segment) => catchAllMinimumSegments(segment) !== undefined);
}

export function matchHttp(claim: Claim, n: HttpEndpointClaim, ctx: MatchContext): ClaimResult {
  const { index } = ctx;
  const text = describeClaim(n);

  if (n.host !== undefined && n.host !== '') {
    const hosts = (ctx.options.serviceHosts ?? []).map((host) => host.toLowerCase());
    if (!hosts.includes(n.host.toLowerCase())) return unknownResult(claim, ctx, 'external_host');
  }

  const claimSegments = pathSegments(n.path);
  const matchesPath = (route: RouteEntry): boolean => segmentsMatch(claimSegments, pathSegments(route.path));
  const implicitHead = (route: RouteEntry): boolean => n.method === 'HEAD' && route.method === 'GET' && route.implicitHead === true;
  const matching = index.routes.filter((route) => (methodMatches(n.method, route.method) || implicitHead(route)) && matchesPath(route));
  const specific = matching.filter((route) => isSpecificEvidence(route.path, n.path));
  const hit = specific.find((route) => route.method === n.method) ?? specific.find((route) => route.method === 'ANY') ?? specific[0];
  if (hit) {
    const implied = implicitHead(hit);
    return toResult(
      claim,
      'verified',
      implied ? 'route_implicit_head' : n.method === 'ANY' ? 'route_any_method' : 'route_exact',
      (implied ? verifiedImplicitHeadStatement : verifiedStatement)({ claim: text, file: hit.file, line: hit.line }),
      [makeEvidence(index, 'match', hit)],
    );
  }
  const catchAll = matching[0];
  if (catchAll) return unknownResult(claim, ctx, 'route_wildcard_only', undefined, [makeEvidence(index, 'nearest', catchAll)]);

  // Old indexes and Express-shaped receivers without a confirmed binding cannot prove the fallback.
  const unconfirmed = n.method === 'HEAD' && index.routes.find((route) => route.method === 'GET' && route.framework === 'express' && matchesPath(route));
  if (unconfirmed) return unknownResult(claim, ctx, 'route_head_unconfirmed', undefined, [makeEvidence(index, 'nearest', unconfirmed)]);

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
