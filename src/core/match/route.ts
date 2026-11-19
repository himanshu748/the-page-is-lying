/** http_endpoint rules (PLAN.md 7.2). */
import type { Claim, ClaimResult, HttpEndpointClaim, RouteEntry } from '../model';
import {
  contradictedRouteStatement,
  contradictedGenericStatement,
  verifiedStatement,
} from '../wording';
import { describeClaim, makeEvidence, toResult } from './evidence';
import { methodMatches, pathSegments, rankRoutes, segmentsMatch } from './nearest';
import { absenceEvidence, coverageReason, unknownResult, type MatchContext } from './results';

function routeText(route: RouteEntry): string {
  return route.method === 'ANY' ? route.path : `${route.method} ${route.path}`;
}

export function matchHttp(claim: Claim, n: HttpEndpointClaim, ctx: MatchContext): ClaimResult {
  const { index } = ctx;
  const text = describeClaim(n);

  if (n.host !== undefined && n.host !== '') {
    const hosts = (ctx.options.serviceHosts ?? []).map((host) => host.toLowerCase());
    if (!hosts.includes(n.host.toLowerCase())) return unknownResult(claim, ctx, 'external_host');
  }

  const claimSegments = pathSegments(n.path);
  const pathMatches = index.routes.filter((route) => segmentsMatch(claimSegments, pathSegments(route.path)));
  const exact = pathMatches.filter((route) => methodMatches(n.method, route.method));
  const hit = exact.find((route) => route.method === n.method) ?? exact[0];
  if (hit) {
    return toResult(
      claim,
      'verified',
      n.method === 'ANY' ? 'route_any_method' : 'route_exact',
      verifiedStatement({ claim: text, file: hit.file, line: hit.line }),
      [makeEvidence(index, 'match', hit)],
    );
  }

  const coverage = index.coverage.routes;
  if (coverage !== 'complete') return unknownResult(claim, ctx, coverageReason(coverage), 'routes');

  // Same path with another method ranks first through methodMatches being false; rankRoutes handles the rest.
  const nearest = rankRoutes(n, index.routes);
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
    );
  }
  return toResult(
    claim,
    'contradicted',
    'route_absent_nearest',
    contradictedRouteStatement({ claim: text, nearest: { text: routeText(top), file: top.file, line: top.line } }),
    evidence,
  );
}
