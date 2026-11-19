import { describe, expect, it } from 'vitest';
import { MAX_BLOCK_TEXT, MAX_BLOCKS, MAX_DEPTH, walkAdf } from '../../../src/core/adf/walk.js';
import { codeBlock, doc, para, text } from '../claims/helpers.js';

describe('walkAdf', () => {
  it('returns [] for anything that is not an ADF object', () => {
    for (const input of [null, undefined, 1, 'x', [], {}, { type: 'doc' }, { type: 'doc', content: 'nope' }]) {
      expect(walkAdf(input)).toEqual([]);
    }
  });

  it('emits paragraphs, headings and code blocks with sequential blockIndex', () => {
    const blocks = walkAdf(
      doc({ type: 'heading', attrs: { level: 2 }, content: [text('Title')] }, para('Hello ', { code: 'world' }), codeBlock('a\nb')),
    );
    expect(blocks.map((b) => [b.blockIndex, b.nodeType, b.text])).toEqual([
      [0, 'heading', 'Title'],
      [1, 'paragraph', 'Hello world'],
      [2, 'codeBlock', 'a\nb'],
    ]);
    expect(blocks[1]?.marks).toEqual([{ start: 6, end: 11, type: 'code' }]);
  });

  it('walks lists, tables, blockquotes, panels and bodiedExtension', () => {
    const inner = (s: string): Record<string, unknown> => para(s);
    const adf = doc(
      { type: 'bulletList', content: [{ type: 'listItem', content: [inner('li')] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [inner('oi')] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [inner('th')] }, { type: 'tableCell', content: [inner('td')] }] }] },
      { type: 'blockquote', content: [inner('bq')] },
      { type: 'panel', attrs: { panelType: 'info' }, content: [inner('pn')] },
      { type: 'bodiedExtension', attrs: { extensionKey: 'k' }, content: [inner('be')] },
      { type: 'expand', content: [{ type: 'nestedExpand', content: [inner('ne')] }] },
    );
    expect(walkAdf(adf).map((b) => b.text)).toEqual(['li', 'oi', 'th', 'td', 'bq', 'pn', 'be', 'ne']);
  });

  it('turns hardBreak into a newline and keeps the visible text of mentions and emoji, as the renderer does', () => {
    const adf = doc({
      type: 'paragraph',
      content: [text('a'), { type: 'hardBreak' }, { type: 'mention', attrs: { text: '@x' } }, text('b'), { type: 'emoji', attrs: { shortName: ':x:' } }],
    });
    expect(walkAdf(adf)[0]?.text).toBe('a\n@xb:x:');
  });

  it('keeps every mark type with its own range', () => {
    const adf = doc({
      type: 'paragraph',
      content: [{ type: 'text', text: 'ab', marks: [{ type: 'strong' }, { type: 'code' }] }, text('cd'), { type: 'text', text: 7 }, { type: 'text', text: 'e', marks: [null, { type: 3 }] }],
    });
    const [block] = walkAdf(adf);
    expect(block?.text).toBe('abcde');
    expect(block?.marks).toEqual([
      { start: 0, end: 2, type: 'strong' },
      { start: 0, end: 2, type: 'code' },
    ]);
  });

  it('skips blocks that are only whitespace', () => {
    expect(walkAdf(doc(para('  \n '), para('x')))).toHaveLength(1);
  });

  it('caps block text, block count and depth', () => {
    const huge = walkAdf(doc(para('x'.repeat(MAX_BLOCK_TEXT * 3))));
    expect(huge[0]?.text).toHaveLength(MAX_BLOCK_TEXT);

    const many = walkAdf(doc(...Array.from({ length: MAX_BLOCKS + 50 }, () => para('x'))));
    expect(many).toHaveLength(MAX_BLOCKS);

    let node: Record<string, unknown> = para('deep');
    for (let i = 0; i < MAX_DEPTH + 10; i++) node = { type: 'blockquote', content: [node] };
    expect(walkAdf(doc(node))).toEqual([]);
  });

  it('handles cyclic-looking shared structures without recursion blowup', () => {
    const shared = para('s');
    const adf = doc(...Array.from({ length: 10 }, () => shared));
    expect(walkAdf(adf)).toHaveLength(10);
  });

  it('stops at the node budget', () => {
    const paragraphs = Array.from({ length: 60_000 }, () => ({ type: 'rule' }));
    expect(walkAdf(doc(...paragraphs, para('late')))).toEqual([]);
  });
});
