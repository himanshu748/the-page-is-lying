/** Nearest-alternative ranking (PLAN.md 7.2). Pure and deterministic: ties break by file then line. Top 3. */
import type { ConfigEntry, EnvEntry, FileEntry, HttpEndpointClaim, RouteEntry } from '../model';
import { jaroWinkler, sharedTokenScore } from './similarity';

export const NEAREST_LIMIT = 3;

function byLocation(a: { file: string; line: number }, b: { file: string; line: number }): number {
  return a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const VERSION_SEGMENT = /^v\d+$/i;

export function pathSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

function isParam(segment: string): boolean {
  return segment === '*' || segment.startsWith(':') || (segment.startsWith('{') && segment.endsWith('}'));
}

/** Claim segments against route segments: route params match anything, claim params match route params. */
export function segmentsMatch(claimSegments: readonly string[], routeSegments: readonly string[]): boolean {
  for (let i = 0; i < routeSegments.length; i++) {
    const route = routeSegments[i] ?? '';
    if (route === '*' && i === routeSegments.length - 1) return claimSegments.length >= i;
    const claim = claimSegments[i];
    if (claim === undefined) return false;
    if (isParam(route)) continue;
    if (isParam(claim) || claim !== route) return false;
  }
  return claimSegments.length === routeSegments.length;
}

export function methodMatches(claimMethod: HttpEndpointClaim['method'], routeMethod: RouteEntry['method']): boolean {
  return claimMethod === 'ANY' || routeMethod === 'ANY' || claimMethod === routeMethod;
}

function stripVersion(segments: string[]): { version?: string; rest: string[] } {
  const first = segments[0];
  if (first !== undefined && VERSION_SEGMENT.test(first)) return { version: first.toLowerCase(), rest: segments.slice(1) };
  return { rest: segments };
}

function routeScore(claim: HttpEndpointClaim, route: RouteEntry): { sameMethod: boolean; score: number } {
  const sameMethod = claim.method === 'ANY' || claim.method === route.method;
  const claimParts = stripVersion(pathSegments(claim.path));
  const routeParts = stripVersion(pathSegments(route.path));
  const versionSwap =
    claimParts.version !== undefined &&
    routeParts.version !== undefined &&
    claimParts.version !== routeParts.version &&
    segmentsMatch(claimParts.rest, routeParts.rest);
  const similarity = jaroWinkler(claimParts.rest.join('/'), routeParts.rest.join('/'));
  const sameDepth = claimParts.rest.length === routeParts.rest.length ? 0.1 : 0;
  return { sameMethod, score: (versionSwap ? 2 : 0) + similarity + sameDepth };
}

/** Same method first, then version swap and path similarity. */
export function rankRoutes(claim: HttpEndpointClaim, routes: readonly RouteEntry[]): RouteEntry[] {
  const scored = routes.map((route) => ({ route, ...routeScore(claim, route) }));
  const candidates = scored.filter((s) => s.sameMethod || s.score >= 0.5);
  candidates.sort((a, b) => {
    if (a.sameMethod !== b.sameMethod) return a.sameMethod ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return byLocation(a.route, b.route);
  });
  const seen = new Set<string>();
  const out: RouteEntry[] = [];
  for (const { route } of candidates) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(route);
    if (out.length === NEAREST_LIMIT) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Env vars
// ---------------------------------------------------------------------------

/** Env vars the code reads, ranked by shared tokens, then string similarity. Code reads beat config listings. */
export function rankEnv(name: string, entries: readonly EnvEntry[]): EnvEntry[] {
  const scored = entries.map((entry) => ({
    entry,
    shared: sharedTokenScore(name, entry.name),
    similarity: jaroWinkler(name.toLowerCase(), entry.name.toLowerCase()),
  }));
  const candidates = scored.filter((s) => s.shared > 0 || s.similarity >= 0.75);
  candidates.sort((a, b) => {
    if (a.shared !== b.shared) return b.shared - a.shared;
    if (a.similarity !== b.similarity) return b.similarity - a.similarity;
    const aCode = a.entry.source === 'code' ? 0 : 1;
    const bCode = b.entry.source === 'code' ? 0 : 1;
    if (aCode !== bCode) return aCode - bCode;
    return byLocation(a.entry, b.entry);
  });
  const seen = new Set<string>();
  const out: EnvEntry[] = [];
  for (const { entry } of candidates) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push(entry);
    if (out.length === NEAREST_LIMIT) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names (scripts, make targets, flags)
// ---------------------------------------------------------------------------

/** Names ranked by similarity to `name`. Returns at most 3. Names are compared case-insensitively. */
export function rankNames(name: string, candidates: readonly string[]): string[] {
  const unique = [...new Set(candidates)];
  const scored = unique.map((candidate) => ({
    candidate,
    score: Math.max(jaroWinkler(name.toLowerCase(), candidate.toLowerCase()), sharedTokenScore(name, candidate)),
  }));
  scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.candidate < b.candidate ? -1 : 1));
  return scored.slice(0, NEAREST_LIMIT).map((s) => s.candidate);
}

// ---------------------------------------------------------------------------
// Config keys
// ---------------------------------------------------------------------------

/** Sibling keys at the deepest existing level of the claimed key path. */
export function rankConfigSiblings(keyPath: string, entries: readonly ConfigEntry[]): ConfigEntry[] {
  const parts = keyPath.split('.');
  for (let depth = parts.length - 1; depth >= 1; depth--) {
    const prefix = `${parts.slice(0, depth).join('.')}.`;
    const siblings = entries.filter((entry) => entry.keyPath.startsWith(prefix));
    if (siblings.length > 0) {
      const last = parts[depth] ?? '';
      const ranked = siblings
        .map((entry) => ({ entry, score: jaroWinkler(last, entry.keyPath.slice(prefix.length).split('.')[0] ?? '') }))
        .sort((a, b) => (a.score !== b.score ? b.score - a.score : byLocation(a.entry, b.entry)));
      return dedupeKeys(ranked.map((r) => r.entry));
    }
  }
  const last = parts[parts.length - 1] ?? keyPath;
  const ranked = entries
    .map((entry) => ({ entry, score: jaroWinkler(last, entry.keyPath.split('.').pop() ?? '') }))
    .filter((r) => r.score >= 0.85)
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : byLocation(a.entry, b.entry)));
  return dedupeKeys(ranked.map((r) => r.entry));
}

function dedupeKeys(entries: ConfigEntry[]): ConfigEntry[] {
  const seen = new Set<string>();
  const out: ConfigEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.keyPath)) continue;
    seen.add(entry.keyPath);
    out.push(entry);
    if (out.length === NEAREST_LIMIT) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/**
 * Files with the same basename elsewhere (likely moved). With none, the head of the listing of the
 * deepest parent directory that exists.
 */
export function rankMovedFiles(path: string, files: readonly FileEntry[]): { moved: boolean; files: FileEntry[] } {
  const base = basename(path).toLowerCase();
  const sameName = files
    .filter((file) => basename(file.path).toLowerCase() === base)
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .slice(0, NEAREST_LIMIT);
  if (sameName.length > 0) return { moved: true, files: sameName };
  const parts = path.replace(/\/+$/, '').split('/');
  for (let depth = parts.length - 1; depth >= 1; depth--) {
    const dir = `${parts.slice(0, depth).join('/')}/`;
    const inDir = files.filter((file) => file.path.startsWith(dir)).sort((a, b) => (a.path < b.path ? -1 : 1));
    if (inDir.length > 0) return { moved: false, files: inDir.slice(0, NEAREST_LIMIT) };
  }
  return { moved: false, files: [] };
}
