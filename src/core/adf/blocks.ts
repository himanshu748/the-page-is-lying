/**
 * The one definition of "text block" and block text, shared by the claim extractor (`walkAdf`) and the
 * Confluence renderer (static/ui/src/render). A claim's `location.blockIndex/start/end` is only meaningful
 * if both sides count the same nodes and build the same text, so neither may keep its own copy.
 *
 * Convention: `blockIndex` is the position, in document order, of a `paragraph`, `heading` or `codeBlock`
 * node among ALL such nodes (blank ones count too). Text blocks are leaves: nothing inside them is a block.
 * Block text is the concatenation of the direct inline children of the node.
 */

/** Nodes whose inline children form one text block. */
export const TEXT_BLOCK_TYPES: ReadonlySet<string> = new Set(['paragraph', 'heading', 'codeBlock']);

interface InlineLike {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
}

/** Text an inline node contributes to its block: text, a line break, or the visible attribute of a mention, emoji or link card. */
export function inlineNodeText(node: InlineLike): string {
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'hardBreak') return '\n';
  const attrs = typeof node.attrs === 'object' && node.attrs !== null ? (node.attrs as Record<string, unknown>) : {};
  for (const key of ['text', 'shortName', 'url']) {
    const value = attrs[key];
    if (typeof value === 'string') return value;
  }
  return '';
}
