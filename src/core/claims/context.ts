import type { NormalizedClaim } from '../model.js';
import type { TextBlock } from '../adf/walk.js';

export interface Range {
  start: number;
  end: number;
}

/** One line of code (a code span line or a code block line), trimmed. */
export interface Segment extends Range {
  text: string;
}

export interface BlockContext {
  block: TextBlock;
  text: string;
  isCodeBlock: boolean;
  /** Merged code ranges: code marks, or the whole text of a code block. */
  codeRegions: Range[];
  /** Code regions split into trimmed, non-empty lines. */
  segments: Segment[];
}

/** An extractor result before ids and ordering are assigned. Offsets are inside the block text. */
export interface Candidate extends Range {
  normalized: NormalizedClaim;
  high: boolean;
}

export const MAX_RAW_LENGTH = 300;

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

function splitLines(text: string, region: Range): Segment[] {
  const segments: Segment[] = [];
  let lineStart = region.start;
  while (lineStart <= region.end) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1 || lineEnd > region.end) lineEnd = region.end;
    let start = lineStart;
    let end = lineEnd;
    while (start < end && /\s/.test(text.charAt(start))) start++;
    while (end > start && /\s/.test(text.charAt(end - 1))) end--;
    if (end > start) segments.push({ start, end, text: text.slice(start, end) });
    lineStart = lineEnd + 1;
  }
  return segments;
}

export function buildContext(block: TextBlock): BlockContext {
  const text = block.text;
  const isCodeBlock = block.nodeType === 'codeBlock';
  const codeRegions = isCodeBlock
    ? [{ start: 0, end: text.length }]
    : mergeRanges(block.marks.filter((m) => m.type === 'code' && m.end > m.start && m.end <= text.length));
  const segments = codeRegions.flatMap((region) => splitLines(text, region));
  return { block, text, isCodeBlock, codeRegions, segments };
}

export function inCode(ctx: BlockContext, start: number, end: number): boolean {
  return ctx.codeRegions.some((r) => start >= r.start && end <= r.end);
}

export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Ranges of http(s) URLs in the text, used to keep other extractors out of URLs. */
export function urlRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const re = /https?:\/\/[^\s`"'<>)\]]+/gi;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}
