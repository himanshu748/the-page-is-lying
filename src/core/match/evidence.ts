/** Evidence construction and untrusted string handling. Pure. */
import { evidenceId } from '../ids';
import type {
  Claim,
  ClaimResult,
  Evidence,
  EvidenceKind,
  FixSuggestion,
  NormalizedClaim,
  ReasonCode,
  RepoIndex,
  RepoRef,
  Verdict,
} from '../model';

export const MAX_UNTRUSTED_LENGTH = 160;

/** Strips control characters (including newlines and tabs) and cuts to 160 chars. */
export function sanitizeUntrusted(text: string, max: number = MAX_UNTRUSTED_LENGTH): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
  const chars = Array.from(cleaned);
  return chars.length <= max ? cleaned : chars.slice(0, max).join('');
}

function encodePath(file: string): string {
  return file.split('/').map(encodeURIComponent).join('/');
}

export function permalink(repo: RepoRef, file: string, line?: number): string {
  if (repo.provider === 'bitbucket') {
    const base = `https://bitbucket.org/${repo.fullName}/src/${repo.sha}/${encodePath(file)}`;
    return line === undefined ? base : `${base}#lines-${line}`;
  }
  const base = `https://github.com/${repo.fullName}/blob/${repo.sha}/${encodePath(file)}`;
  return line === undefined ? base : `${base}#L${line}`;
}

export interface Location {
  file: string;
  line?: number;
  snippet?: string;
}

export function makeEvidence(index: RepoIndex, kind: EvidenceKind, loc?: Location, scope?: string): Evidence {
  const sha = index.repo.sha;
  if (!loc) {
    return { id: evidenceId({ sha, kind, ...(scope !== undefined ? { scope } : {}) }), kind };
  }
  const evidence: Evidence = {
    id: evidenceId({ sha, file: loc.file, ...(loc.line !== undefined ? { line: loc.line } : {}), kind }),
    kind,
    file: loc.file,
  };
  if (loc.line !== undefined) evidence.line = loc.line;
  if (loc.snippet !== undefined && loc.snippet !== '') evidence.snippet = sanitizeUntrusted(loc.snippet);
  evidence.permalink = permalink(index.repo, loc.file, loc.line);
  return evidence;
}

export function toResult(
  claim: Claim,
  verdict: Verdict,
  reason: ReasonCode,
  statement: string,
  evidence: Evidence[],
  suggestion?: FixSuggestion,
): ClaimResult {
  // Statements embed repo-derived names (routes, env vars, flags), so strip control chars and cap length here too.
  const result: ClaimResult = {
    claim: { ...claim, raw: sanitizeUntrusted(claim.raw) },
    verdict,
    reason,
    statement: sanitizeUntrusted(statement, 500),
    evidence,
  };
  if (suggestion !== undefined && verdict === 'contradicted') result.suggestion = suggestion;
  return result;
}

export const MAX_SUGGESTION_ALTERNATIVES = 3;
/** A replacement is quoted in full or not at all: a shortened path or route would name something that does not exist. */
export const MAX_SUGGESTION_LENGTH = 300;

/**
 * Suggestion for a contradicted claim. `candidates` are the code's counterparts, best first, in the same order
 * as the `nearest` evidence. With no candidate the suggestion is `remove`. When the best candidate is too long
 * to quote in full there is no suggestion: the cited evidence still names it.
 */
export function makeSuggestion(candidates: readonly string[], evidence?: Evidence): FixSuggestion | undefined {
  const cleaned = candidates.map((candidate) => sanitizeUntrusted(candidate, Number.MAX_SAFE_INTEGER)).filter((candidate) => candidate !== '');
  const [replacement, ...others] = cleaned;
  if (replacement === undefined) return { kind: 'remove' };
  if (Array.from(replacement).length > MAX_SUGGESTION_LENGTH) return undefined;
  const rest = others.filter((candidate) => Array.from(candidate).length <= MAX_SUGGESTION_LENGTH);
  const suggestion: FixSuggestion = { kind: 'replace', replacement };
  if (evidence !== undefined) suggestion.evidenceId = evidence.id;
  const alternatives = [...new Set(rest)].filter((candidate) => candidate !== replacement).slice(0, MAX_SUGGESTION_ALTERNATIVES);
  if (alternatives.length > 0) suggestion.alternatives = alternatives;
  return suggestion;
}

/** Human readable claim text built from the normalized claim, never from the raw page text. */
export function describeClaim(n: NormalizedClaim): string {
  let text: string;
  switch (n.type) {
    case 'http_endpoint': {
      const target = `${n.host ?? ''}${n.path}`;
      text = n.method === 'ANY' ? target : `${n.method} ${target}`;
      break;
    }
    case 'env_var':
      text = n.name;
      break;
    case 'cli':
      text = [n.program, ...n.subcommands, ...n.flags].join(' ');
      if (n.defaultValue !== undefined) text += ` defaults to ${n.defaultValue}`;
      break;
    case 'config_key':
      text = n.file === undefined ? n.keyPath : `${n.keyPath} in ${n.file}`;
      break;
    case 'file_path':
      text = n.path;
      break;
    case 'package_version':
      text = `${n.name}@${n.range}`;
      break;
  }
  return sanitizeUntrusted(text);
}
