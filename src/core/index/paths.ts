/**
 * Route path normalization. Matches the contract on HttpEndpointClaim.path in
 * src/core/model.ts: params become ":param", no query, fragment or trailing slash.
 */

const MAX_PATH_LENGTH = 512;

export function normalizeRoutePath(input: string): string {
  // Replacements can expose new matches ("{{a}}"), so repeat until stable. Idempotent by construction.
  let prev = input.length > MAX_PATH_LENGTH ? input.slice(0, MAX_PATH_LENGTH) : input;
  for (let i = 0; i < 6; i++) {
    const next = normalizeOnce(prev);
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

function normalizeOnce(input: string): string {
  let p = input;
  p = p.replace(/[?#].*$/s, '');
  // Express style ":id", ":id?", ":id(\\d+)"
  p = p.replace(/:[A-Za-z_][\w-]*(?:\([^)]*\))?\??/g, ':param');
  // OpenAPI / FastAPI / Go 1.22 style "{id}", "{id:regex}", "{id...}"
  p = p.replace(/\{[^{}/]*\}/g, ':param');
  // Flask style "<id>", "<int:id>"
  p = p.replace(/<[^<>/]*>/g, ':param');
  p = p.replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** Join a mount prefix and a route path, then normalize. */
export function joinRoute(prefix: string, path: string): string {
  const left = prefix === '' || prefix === '/' ? '' : prefix.replace(/\/+$/, '');
  const right = path === '' || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  const joined = `${left}${right}`;
  return normalizeRoutePath(joined === '' ? '/' : joined);
}
