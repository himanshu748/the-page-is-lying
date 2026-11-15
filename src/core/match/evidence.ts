/** Evidence construction and untrusted string handling. Pure. */
import { evidenceId } from '../ids';
import type {
  Claim,
  ClaimResult,
  Evidence,
  EvidenceKind,
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
): ClaimResult {
  // Statements embed repo-derived names (routes, env vars, flags), so strip control chars and cap length here too.
  return {
    claim: { ...claim, raw: sanitizeUntrusted(claim.raw) },
    verdict,
    reason,
    statement: sanitizeUntrusted(statement, 500),
    evidence,
  };
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
