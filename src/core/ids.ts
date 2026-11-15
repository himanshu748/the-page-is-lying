/**
 * Stable claim and evidence IDs (PLAN.md section 7.1). Pure: no node:crypto in core.
 * 32-bit FNV-1a followed by a murmur3 style finalizer, rendered as 8 hex chars.
 */
import type { EvidenceKind, NormalizedClaim } from './model';

export function hash8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** JSON with sorted keys, so equal claims always serialize equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/** `c_<hash8>(blockIndex, start, normalized)`. */
export function claimId(blockIndex: number, start: number, normalized: NormalizedClaim): string {
  return `c_${hash8(`${blockIndex}|${start}|${stableStringify(normalized)}`)}`;
}

/**
 * `ev_<hash8>(sha, file, line, kind)`. `scope` only separates evidence that has no file
 * (absence and coverage entries), so an env absence and a route absence do not share an ID.
 */
export function evidenceId(args: { sha: string; file?: string; line?: number; kind: EvidenceKind; scope?: string }): string {
  const parts = [args.sha, args.file ?? '', args.line === undefined ? '' : String(args.line), args.kind];
  if (args.file === undefined && args.scope !== undefined) parts.push(args.scope);
  return `ev_${hash8(parts.join('|'))}`;
}
