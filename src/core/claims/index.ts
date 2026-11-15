import type { Claim, ClaimType } from '../model';
import { MAX_BLOCK_TEXT, walkAdf, type TextBlock } from '../adf/walk';
import { extractCli } from './cli';
import { extractConfig } from './config';
import { buildContext, MAX_RAW_LENGTH, overlaps, type Candidate } from './context';
import { extractEnv } from './env';
import { extractFiles } from './files';
import { extractHttp } from './http';
import { extractPackages } from './packages';

export const MAX_CLAIMS_PER_DOCUMENT = 200;
export const MAX_CLAIMS_PER_BLOCK = 20;

export interface ExtractionResult {
  claims: Claim[];
  /** True when claims were dropped because of the per-document cap. */
  claimsTruncated: boolean;
}

/** Strongest first. Weak types (file_path, config_key) never overlap a stronger claim. */
const PRIORITY: ClaimType[] = ['http_endpoint', 'cli', 'package_version', 'env_var', 'config_key', 'file_path'];
const EXCLUSIVE: ReadonlySet<ClaimType> = new Set<ClaimType>(['config_key', 'file_path']);

/** FNV-1a, 32 bit, as 8 hex digits. Deterministic and dependency free. */
function hash8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function resolve(candidates: Candidate[]): Candidate[] {
  const accepted: Candidate[] = [];
  for (const type of PRIORITY) {
    const ofType = candidates
      .filter((c) => c.normalized.type === type && c.end > c.start && c.end - c.start <= MAX_RAW_LENGTH)
      .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
    for (const candidate of ofType) {
      const clash = accepted.some((a) => {
        if (!overlaps(a, candidate)) return false;
        return a.normalized.type === type || EXCLUSIVE.has(type);
      });
      if (!clash) accepted.push(candidate);
    }
  }
  return accepted.sort((a, b) => a.start - b.start || a.end - b.end);
}

function extractFromBlock(block: TextBlock): Candidate[] {
  const ctx = buildContext(block);
  return resolve([
    ...extractHttp(ctx),
    ...extractCli(ctx),
    ...extractPackages(ctx),
    ...extractEnv(ctx),
    ...extractConfig(ctx),
    ...extractFiles(ctx),
  ]);
}

function extractFromBlocks(blocks: TextBlock[]): ExtractionResult {
  const claims: Claim[] = [];
  let claimsTruncated = false;
  for (const block of blocks) {
    const candidates = extractFromBlock(block).slice(0, MAX_CLAIMS_PER_BLOCK);
    for (const c of candidates) {
      if (claims.length >= MAX_CLAIMS_PER_DOCUMENT) {
        claimsTruncated = true;
        break;
      }
      claims.push({
        id: `c_${hash8(`${block.blockIndex}:${c.start}:${JSON.stringify(c.normalized)}`)}`,
        type: c.normalized.type,
        raw: block.text.slice(c.start, c.end),
        normalized: c.normalized,
        location: { blockIndex: block.blockIndex, start: c.start, end: c.end },
        confidence: c.high ? 'high' : 'medium',
      });
    }
  }
  return { claims, claimsTruncated };
}

function parseInput(adf: unknown): unknown {
  if (typeof adf !== 'string') return adf;
  if (adf.length > 2_000_000) return null;
  try {
    return JSON.parse(adf) as unknown;
  } catch {
    return null;
  }
}

/** Extracts checkable claims from an ADF document (object or JSON string). Never throws. */
export function extractClaims(adf: unknown): ExtractionResult {
  return extractFromBlocks(walkAdf(parseInput(adf)));
}

/**
 * Extracts claims from plain text. Backtick spans and ``` fences count as code, like ADF code
 * marks and code blocks. Offsets refer to the (length capped) text, which is block 0.
 */
export function extractClaimsFromText(text: string): ExtractionResult {
  if (typeof text !== 'string') return { claims: [], claimsTruncated: false };
  const body = text.slice(0, MAX_BLOCK_TEXT);
  const marks: TextBlock['marks'] = [];
  const fenced = /```[^\n]*\n([\s\S]*?)```/g;
  const fences: { start: number; end: number }[] = [];
  for (let m = fenced.exec(body); m !== null; m = fenced.exec(body)) {
    const start = m.index + m[0].length - 3 - (m[1] ?? '').length;
    fences.push({ start: m.index, end: m.index + m[0].length });
    marks.push({ start, end: start + (m[1] ?? '').length, type: 'code' });
  }
  const inline = /`([^`\n]+)`/g;
  for (let m = inline.exec(body); m !== null; m = inline.exec(body)) {
    const start = m.index + 1;
    const range = { start: m.index, end: m.index + m[0].length };
    if (fences.some((f) => overlaps(f, range))) continue;
    marks.push({ start, end: start + (m[1] ?? '').length, type: 'code' });
  }
  return extractFromBlocks([{ blockIndex: 0, nodeType: 'paragraph', text: body, marks }]);
}
