import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { ClaimMark } from '../claims/ClaimMark';
import { TEXT_BLOCKS, blockText, indexBlocks, inlineText } from './adf';
import type { AdfMark, AdfNode, Placement, Placements } from './adf';

interface Piece {
  text: string;
  marks: AdfMark[];
  isBreak: boolean;
  claim?: Placement;
}

function applyMarks(text: string, marks: AdfMark[], key: string): ReactNode {
  let node: ReactNode = text;
  for (const mark of marks) {
    if (mark.type === 'code') node = <code>{node}</code>;
    else if (mark.type === 'strong') node = <strong>{node}</strong>;
    else if (mark.type === 'em') node = <em>{node}</em>;
    else if (mark.type === 'strike') node = <s>{node}</s>;
    else if (mark.type === 'link') node = <span className="link-text">{node}</span>;
    else if (mark.type === 'underline') node = <u>{node}</u>;
  }
  return <Fragment key={key}>{node}</Fragment>;
}

/** Splits a block's inline nodes at claim boundaries and groups pieces of one claim under one ClaimMark. */
function renderInline(block: AdfNode, placements: Placement[]): ReactNode[] {
  const pieces: Piece[] = [];
  let offset = 0;
  for (const child of block.content ?? []) {
    const text = inlineText(child);
    const isBreak = child.type === 'hardBreak';
    const marks = child.marks ?? [];
    const end = offset + text.length;
    if (isBreak || text === '') {
      if (isBreak) pieces.push({ text, marks, isBreak, ...(claimAt(placements, offset) ? { claim: claimAt(placements, offset) as Placement } : {}) });
      offset = end;
      continue;
    }
    let cursor = offset;
    while (cursor < end) {
      const inside = claimAt(placements, cursor);
      const boundary = inside
        ? Math.min(end, inside.end)
        : Math.min(end, ...placements.filter((p) => p.start > cursor).map((p) => p.start));
      pieces.push({ text: text.slice(cursor - offset, boundary - offset), marks, isBreak: false, ...(inside ? { claim: inside } : {}) });
      cursor = boundary;
    }
    offset = end;
  }

  const out: ReactNode[] = [];
  let i = 0;
  while (i < pieces.length) {
    const piece = pieces[i] as Piece;
    if (!piece.claim) {
      out.push(piece.isBreak ? <br key={`b${i}`} /> : applyMarks(piece.text, piece.marks, `t${i}`));
      i += 1;
      continue;
    }
    const claim = piece.claim;
    const group: ReactNode[] = [];
    while (i < pieces.length && (pieces[i] as Piece).claim === claim) {
      const p = pieces[i] as Piece;
      group.push(p.isBreak ? <br key={`b${i}`} /> : applyMarks(p.text, p.marks, `t${i}`));
      i += 1;
    }
    out.push(
      <ClaimMark key={`c${claim.result.claim.id}`} result={claim.result}>
        {group}
      </ClaimMark>,
    );
  }
  return out;
}

function claimAt(placements: Placement[], position: number): Placement | undefined {
  return placements.find((p) => p.start <= position && position < p.end);
}

interface Ctx {
  indexes: Map<AdfNode, number>;
  placements: Placements;
}

function renderChildren(node: AdfNode, ctx: Ctx): ReactNode {
  return (node.content ?? []).map((child, i) => <Fragment key={i}>{renderNode(child, ctx)}</Fragment>);
}

function renderNode(node: AdfNode, ctx: Ctx): ReactNode {
  if (TEXT_BLOCKS.has(node.type)) {
    const index = ctx.indexes.get(node) ?? -1;
    const placements = ctx.placements.byBlock.get(index) ?? [];
    if (node.type === 'codeBlock') {
      return (
        <pre className="adf-code">
          <code>{placements.length > 0 ? renderInline(node, placements) : blockText(node)}</code>
        </pre>
      );
    }
    const inline = renderInline(node, placements);
    if (node.type === 'heading') {
      const raw = Number(node.attrs?.['level']);
      const level = Number.isInteger(raw) ? Math.min(6, Math.max(1, raw)) : 2;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return <Tag className="adf-heading">{inline}</Tag>;
    }
    return <p>{inline}</p>;
  }
  switch (node.type) {
    case 'doc':
      return <div className="adf-doc">{renderChildren(node, ctx)}</div>;
    case 'bulletList':
      return <ul>{renderChildren(node, ctx)}</ul>;
    case 'orderedList':
      return <ol>{renderChildren(node, ctx)}</ol>;
    case 'listItem':
      return <li>{renderChildren(node, ctx)}</li>;
    case 'blockquote':
      return <blockquote>{renderChildren(node, ctx)}</blockquote>;
    case 'panel':
      return <div className="adf-panel">{renderChildren(node, ctx)}</div>;
    case 'rule':
      return <hr />;
    case 'table':
      return (
        <table className="adf-table">
          <tbody>{renderChildren(node, ctx)}</tbody>
        </table>
      );
    case 'tableRow':
      return <tr>{renderChildren(node, ctx)}</tr>;
    case 'tableHeader':
      return <th scope="col">{renderChildren(node, ctx)}</th>;
    case 'tableCell':
      return <td>{renderChildren(node, ctx)}</td>;
    default:
      return (
        <div className="adf-unsupported">
          <small>Shown as plain text: {node.type} is not supported here.</small>
          {node.content ? renderChildren(node, ctx) : null}
        </div>
      );
  }
}

/** Renders the ADF subset as React text. No raw HTML is ever injected. */
export function AdfRenderer({ doc, placements }: { doc: AdfNode; placements: Placements }) {
  const indexes = indexBlocks(doc);
  return <>{renderNode(doc, { indexes, placements })}</>;
}
