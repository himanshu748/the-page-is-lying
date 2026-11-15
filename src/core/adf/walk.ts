/**
 * ADF walker: turns an Atlassian Document Format tree into flat text blocks.
 *
 * The input is untrusted and may be any JSON. The walker never throws, never
 * evaluates anything, and caps depth, node count, block count and text length.
 */

import { TEXT_BLOCK_TYPES, inlineNodeText } from './blocks.js';

export interface TextMark {
  /** Offsets into `TextBlock.text`, end exclusive. */
  start: number;
  end: number;
  /** ADF mark type, e.g. "code", "strong", "link". */
  type: string;
}

export interface TextBlock {
  blockIndex: number;
  /** "paragraph", "heading" or "codeBlock". Containers are walked, not emitted. */
  nodeType: string;
  text: string;
  marks: TextMark[];
}

export const MAX_DEPTH = 64;
export const MAX_NODES = 50_000;
export const MAX_BLOCKS = 5_000;
export const MAX_BLOCK_TEXT = 20_000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childrenOf(node: Json): unknown[] {
  const content = node['content'];
  return Array.isArray(content) ? content : [];
}

interface Builder {
  text: string;
  marks: TextMark[];
}

function appendText(builder: Builder, value: string, markTypes: string[]): void {
  const room = MAX_BLOCK_TEXT - builder.text.length;
  if (room <= 0 || value === '') return;
  const piece = value.length > room ? value.slice(0, room) : value;
  const start = builder.text.length;
  builder.text += piece;
  for (const type of markTypes) {
    builder.marks.push({ start, end: start + piece.length, type });
  }
}

function collectInline(node: unknown, builder: Builder, budget: { nodes: number }): void {
  if (!isObject(node) || budget.nodes-- <= 0) return;
  const text = inlineNodeText(node);
  if (text === '') return;
  const markTypes: string[] = [];
  const marks = node['marks'];
  if (node['type'] === 'text' && Array.isArray(marks)) {
    for (const mark of marks) {
      if (isObject(mark) && typeof mark['type'] === 'string') markTypes.push(mark['type']);
    }
  }
  appendText(builder, text, markTypes);
}

/** Walks an ADF document into text blocks. Returns [] for anything that is not ADF. */
export function walkAdf(doc: unknown): TextBlock[] {
  const blocks: TextBlock[] = [];
  /** Counts every text block node, blank ones too, so indexes match the renderer (see blocks.ts). */
  let seen = 0;
  const budget = { nodes: MAX_NODES };

  const visit = (node: unknown, depth: number): void => {
    if (!isObject(node) || depth > MAX_DEPTH || budget.nodes-- <= 0 || seen >= MAX_BLOCKS) return;
    const type = node['type'];
    if (typeof type === 'string' && TEXT_BLOCK_TYPES.has(type)) {
      const builder: Builder = { text: '', marks: [] };
      for (const child of childrenOf(node)) collectInline(child, builder, budget);
      const blockIndex = seen++;
      if (builder.text.trim() !== '') {
        blocks.push({ blockIndex, nodeType: type, text: builder.text, marks: builder.marks });
      }
      return;
    }
    // doc, bodiedExtension, extension, blockquote, panel, list, listItem, table, tableRow, tableCell, ...
    for (const child of childrenOf(node)) visit(child, depth + 1);
  };

  visit(doc, 0);
  return blocks;
}
