import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  /** Rendered as the dialog's labelled heading. Omit and pass `labelledBy` to render your own. */
  title?: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  onClose: () => void;
  /**
   * The teacher has typed something. While dirty (or busy), clicking the overlay or
   * pressing Escape does nothing: only an explicit Cancel/Close button closes the dialog,
   * so a stray click never throws away a half-filled form.
   */
  dirty?: boolean;
  /** A request is in flight: nothing closes the dialog. */
  busy?: boolean;
  className?: string;
  overlayClassName?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}

/** Accessible dialog: labelled, focus moved in and trapped, focus restored, scroll locked. */
export default function Modal({
  title, labelledBy, describedBy, onClose, dirty = false, busy = false,
  className = '', overlayClassName = '', style, children,
}: ModalProps) {
  const autoId = useId();
  const titleId = labelledBy ?? `${autoId}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const pressStartedOnOverlay = useRef(false);
  // Captured during the first render, before any child `autoFocus` moves focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const canDismiss = !dirty && !busy;

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Respect a child's autoFocus; otherwise focus the dialog itself.
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (canDismiss) onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <div
      className={`modal-overlay ${overlayClassName}`.trim()}
      onMouseDown={(e) => { pressStartedOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        // Only a press that started and ended on the overlay counts (not a text-selection drag).
        if (e.target === e.currentTarget && pressStartedOnOverlay.current && canDismiss) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={style}
      >
        {title !== undefined && <h2 id={titleId} className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
