import type { Claim, ClaimType } from '../model';
import { MAX_BLOCK_TEXT, walkAdf, type TextBlock } from '../adf/walk';
import { extractCli } from './cli';
import { extractConfig, findConfigFiles } from './config';
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

type ClaimSource = { text: string; offset: number; configFiles: ReturnType<typeof findConfigFiles> };

function extractFromBlock(block: TextBlock, source?: ClaimSource): Candidate[] {
  const ctx = buildContext(block);
  return resolve([
    ...extractHttp(ctx),
    ...extractCli(ctx, source),
    ...extractPackages(ctx),
    ...extractEnv(ctx),
    ...extractConfig(ctx, source?.configFiles, source?.offset),
    ...extractFiles(ctx),
  ]);
}

type ClaimBlock = TextBlock & { sourceOffset?: number };

function extractFromBlocks(blocks: Iterable<ClaimBlock>, sourceText?: string): ExtractionResult {
  const claims: Claim[] = [];
  const configFiles = sourceText === undefined ? [] : findConfigFiles(sourceText);
  for (const block of blocks) {
    const offset = block.sourceOffset ?? 0;
    const source = sourceText === undefined ? undefined : { text: sourceText, offset, configFiles };
    const candidates = extractFromBlock(block, source).slice(0, MAX_CLAIMS_PER_BLOCK);
    for (const c of candidates) {
      if (claims.length >= MAX_CLAIMS_PER_DOCUMENT) {
        return { claims, claimsTruncated: true };
      }
      const start = offset + c.start;
      const end = offset + c.end;
      claims.push({
        id: `c_${hash8(`${block.blockIndex}:${start}:${JSON.stringify(c.normalized)}`)}`,
        type: c.normalized.type,
        raw: block.text.slice(c.start, c.end),
        normalized: c.normalized,
        location: { blockIndex: block.blockIndex, start, end },
        confidence: c.high ? 'high' : 'medium',
      });
    }
  }
  return { claims, claimsTruncated: false };
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

function* plainTextBlocks(body: string): Iterable<ClaimBlock> {
  function* paragraphs(start: number, end: number): Iterable<ClaimBlock> {
    for (const text of body.slice(start, end).split(/(\r?\n(?:[ \t]*\r?\n)+)/)) {
      if (text.trim() !== '') {
        const marks = Array.from(text.matchAll(/`([^`\r\n]+)`/g), (match) => ({
          start: match.index + 1,
          end: match.index + match[0].length - 1,
          type: 'code',
        }));
        yield { blockIndex: 0, sourceOffset: start, nodeType: 'paragraph', text, marks };
      }
      start += text.length;
    }
  }

  let proseStart = 0;
  let fence: { marker: string; start: number } | undefined;
  for (const match of body.matchAll(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/gm)) {
    const [, marker = '', info = ''] = match;
    if (fence) {
      if (!marker.startsWith(fence.marker) || info.trim() !== '') continue;
      yield { blockIndex: 0, sourceOffset: fence.start, nodeType: 'codeBlock', text: body.slice(fence.start, match.index), marks: [] };
      proseStart = match.index + match[0].length;
      fence = undefined;
    } else if (marker[0] !== '`' || !info.includes('`')) {
      yield* paragraphs(proseStart, match.index);
      fence = { marker, start: match.index + match[0].length };
    }
  }
  if (fence) {
    yield { blockIndex: 0, sourceOffset: fence.start, nodeType: 'codeBlock', text: body.slice(fence.start), marks: [] };
  } else {
    yield* paragraphs(proseStart, body.length);
  }
}

/** Each paragraph and fence gets its own claim budget. Locations still use full text offsets in block 0. */
export function extractClaimsFromText(text: string): ExtractionResult {
  if (typeof text !== 'string') return { claims: [], claimsTruncated: false };
  const body = text.slice(0, MAX_BLOCK_TEXT);
  return extractFromBlocks(plainTextBlocks(body), body);
}
