import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import type { ClaimResult } from '@core/model';
import { STATUS_LABEL, StatusIcon } from '../status';
import { EvidenceDetails } from './EvidenceCard';

interface Shift {
  above: boolean;
  dx: number;
}

/**
 * One highlighted claim: a button (icon + visible label + distinct underline) and a hover/focus card.
 * Opens on hover and focus, closes on Escape and when focus leaves. The card is a child of the wrapper,
 * so moving the pointer onto it keeps it open.
 */
export function ClaimMark({ result, children }: { result: ClaimResult; children: ReactNode }) {
  const cardId = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState<Shift>({ above: false, dx: 0 });

  useLayoutEffect(() => {
    if (!open || !card.current || !wrapper.current) return;
    const cardBox = card.current.getBoundingClientRect();
    const anchor = wrapper.current.getBoundingClientRect();
    const margin = 8;
    const overflowBottom = anchor.bottom + cardBox.height > window.innerHeight - margin;
    const roomAbove = anchor.top - cardBox.height >= margin;
    let dx = 0;
    if (cardBox.right > window.innerWidth - margin) dx = window.innerWidth - margin - cardBox.right;
    if (cardBox.left + dx < margin) dx = margin - cardBox.left;
    setShift((previous) => (previous.above === (overflowBottom && roomAbove) && previous.dx === dx ? previous : { above: overflowBottom && roomAbove, dx }));
  }, [open]);

  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !wrapper.current?.contains(next)) setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  };

  const verdict = result.verdict;
  return (
    <span
      ref={wrapper}
      className="claim-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!wrapper.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <button
        ref={button}
        type="button"
        className={`claim claim-${verdict}`}
        data-testid="claim"
        data-verdict={verdict}
        aria-describedby={cardId}
        onClick={() => setOpen(true)}
      >
        <StatusIcon verdict={verdict} />
        <span className="claim-text">{children}</span>
        <span className="claim-label">{STATUS_LABEL[verdict]}</span>
      </button>
      <span
        ref={card}
        id={cardId}
        role="group"
        aria-label={`Evidence for ${result.claim.raw.slice(0, 80)}`}
        className={`card${shift.above ? ' card-above' : ''}`}
        style={shift.dx === 0 ? undefined : { transform: `translateX(${shift.dx}px)` }}
        hidden={!open}
        data-testid="evidence-card"
      >
        <EvidenceDetails result={result} />
      </span>
    </span>
  );
}
