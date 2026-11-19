import { extractClaims, extractClaimsFromText } from '../../../src/core/claims/index.js';
import type { Claim, ClaimType, NormalizedClaim } from '../../../src/core/model.js';

export type Part = string | { code: string };

export function text(value: string, code = false): Record<string, unknown> {
  return code ? { type: 'text', text: value, marks: [{ type: 'code' }] } : { type: 'text', text: value };
}

/** Paragraph from plain strings and `{ code }` spans. */
export function para(...parts: Part[]): Record<string, unknown> {
  return {
    type: 'paragraph',
    content: parts.map((part) => (typeof part === 'string' ? text(part) : text(part.code, true))),
  };
}

export function codeBlock(value: string): Record<string, unknown> {
  return { type: 'codeBlock', attrs: { language: 'bash' }, content: [text(value)] };
}

export function doc(...content: Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, type: 'doc', content };
}

/** Normalized claims of one type found in markdown-ish text (backticks mark code). */
export function fromText(input: string, type: ClaimType): NormalizedClaim[] {
  return extractClaimsFromText(input)
    .claims.filter((c) => c.type === type)
    .map((c) => c.normalized);
}

export function allFromText(input: string): Claim[] {
  return extractClaimsFromText(input).claims;
}

export function fromAdf(adf: unknown, type?: ClaimType): NormalizedClaim[] {
  return extractClaims(adf)
    .claims.filter((c) => type === undefined || c.type === type)
    .map((c) => c.normalized);
}
