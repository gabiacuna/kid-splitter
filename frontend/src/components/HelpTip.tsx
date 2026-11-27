import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';

const GAP = 8;
const MARGIN = 8;

/**
 * Small ⓘ button with a tooltip. Opens on hover, keyboard focus and tap; Escape or
 * leaving closes it. The tooltip is always in the DOM (hidden) so `aria-describedby`
 * gives screen readers the text even when it isn't shown.
 * The bubble is portaled to <body> with fixed positioning so scroll containers
 * (e.g. `.table-wrap { overflow-x: auto }`) can't clip it.
 * `text` must already be translated (pass `t('…')`).
 */
export default function HelpTip({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const focusedAt = useRef(0);
  const btn = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  // Place the bubble above the button (below if there's no room), kept inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!btn.current || !bubble.current) return;
      const b = btn.current.getBoundingClientRect();
      const { width, height } = bubble.current.getBoundingClientRect();
      const above = b.top - GAP - height >= MARGIN;
      const top = above ? b.top - GAP - height : b.bottom + GAP;
      const left = Math.min(
        Math.max(b.left + b.width / 2 - width / 2, MARGIN),
        window.innerWidth - MARGIN - width,
      );
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, text]);

  return (
    <span className="helptip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        ref={btn}
        type="button"
        className="helptip-btn"
        aria-label={label ?? t('More information')}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => { focusedAt.current = Date.now(); setOpen(true); }}
        onBlur={() => setOpen(false)}
        // A tap fires focus then click; don't let that click immediately close it again.
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (Date.now() - focusedAt.current > 300) setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
      >
        <span aria-hidden>i</span>
      </button>
      {createPortal(
        <span
          ref={bubble}
          role="tooltip"
          id={id}
          className={`helptip-bubble${open ? ' open' : ''}`}
          style={pos}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}
