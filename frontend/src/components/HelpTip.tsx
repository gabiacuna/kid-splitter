import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../i18n';

/**
 * Small ⓘ button with a tooltip. Opens on hover, keyboard focus and tap; Escape or
 * leaving closes it. The tooltip is always in the DOM (hidden) so `aria-describedby`
 * gives screen readers the text even when it isn't shown.
 * `text` must already be translated (pass `t('…')`).
 */
export default function HelpTip({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const focusedAt = useRef(0);
  const bubble = useRef<HTMLSpanElement>(null);

  // Keep the bubble inside the viewport on narrow screens.
  useLayoutEffect(() => {
    if (!open || !bubble.current) { setShift(0); return; }
    const r = bubble.current.getBoundingClientRect();
    const margin = 8;
    if (r.left < margin) setShift(margin - r.left);
    else if (r.right > window.innerWidth - margin) setShift(window.innerWidth - margin - r.right);
  }, [open]);

  return (
    <span className="helptip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
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
      <span
        ref={bubble}
        role="tooltip"
        id={id}
        className={`helptip-bubble${open ? ' open' : ''}`}
        style={shift ? { transform: `translateX(calc(-50% + ${shift}px))` } : undefined}
      >
        {text}
      </span>
    </span>
  );
}
