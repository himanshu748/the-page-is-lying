import { TEXT_BLOCK_TYPES, inlineNodeText } from '@core/adf/blocks';
import type { ClaimResult } from '@core/model';

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

/** Nodes whose inline children form one text block. Block indexes count these in document order. */
export const TEXT_BLOCKS = TEXT_BLOCK_TYPES;

export function isAdfNode(value: unknown): value is AdfNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export function asDoc(value: unknown): AdfNode | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  }
  return isAdfNode(candidate) && candidate.type === 'doc' ? candidate : null;
}

/** Text an inline node contributes to its block. */
export function inlineText(node: AdfNode): string {
  return inlineNodeText(node);
}

export function blockText(block: AdfNode): string {
  return (block.content ?? []).map(inlineText).join('');
}

/** Assigns an index to each text block in document order. */
export function indexBlocks(doc: AdfNode): Map<AdfNode, number> {
  const map = new Map<AdfNode, number>();
  let next = 0;
  const walk = (node: AdfNode): void => {
    if (TEXT_BLOCKS.has(node.type)) {
      map.set(node, next++);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return map;
}

export interface Placement {
  result: ClaimResult;
  start: number;
  end: number;
}

export interface Placements {
  byBlock: Map<number, Placement[]>;
  unplaced: ClaimResult[];
}

/**
 * Places claims by blockIndex/start/end. When the offsets do not select `raw` (for example because another
 * walker counted an inline node differently), falls back to the first occurrence of `raw` in the block.
 * Overlapping or missing claims end up in `unplaced` so they stay visible.
 */
export function placeClaims(doc: AdfNode, results: readonly ClaimResult[]): Placements {
  const blocks = indexBlocks(doc);
  const textByIndex = new Map<number, string>();
  for (const [node, index] of blocks) textByIndex.set(index, blockText(node));

  const byBlock = new Map<number, Placement[]>();
  const unplaced: ClaimResult[] = [];
  for (const result of results) {
    const { blockIndex, start, end } = result.claim.location;
    const text = textByIndex.get(blockIndex);
    const raw = result.claim.raw;
    let s = -1;
    if (text !== undefined) {
      if (text.slice(start, end) === raw && raw !== '') s = start;
      else if (raw !== '') s = text.indexOf(raw);
    }
    if (s < 0) {
      unplaced.push(result);
      continue;
    }
    const placement: Placement = { result, start: s, end: s + raw.length };
    const list = byBlock.get(blockIndex) ?? [];
    if (list.some((p) => p.start < placement.end && placement.start < p.end)) {
      unplaced.push(result);
      continue;
    }
    list.push(placement);
    list.sort((a, b) => a.start - b.start);
    byBlock.set(blockIndex, list);
  }
  return { byBlock, unplaced };
}
