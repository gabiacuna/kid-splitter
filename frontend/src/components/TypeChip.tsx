import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDownIcon } from './Icons';

export type ChipOption<V extends string> = { value: V; label: string };

/**
 * A coloured pill that opens a small styled menu (a native <select> list can't be styled).
 * Keyboard: Enter/Space/ArrowDown open, ArrowUp/ArrowDown move, Enter picks, Escape/Tab close.
 * Closed, ArrowUp/ArrowDown step the value directly, like a native select.
 */
export default function TypeChip<V extends string>({ value, options, onChange, label, className = '' }: {
  value: V;
  options: ChipOption<V>[];
  onChange: (v: V) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[index];

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function openMenu() { setActive(index); setOpen(true); }
  function pick(v: V) {
    setOpen(false);
    buttonRef.current?.focus();
    if (v !== value) onChange(v);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const last = options.length - 1;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? Math.min(last, index + 1) : Math.max(0, index - 1);
        if (next !== index) onChange(options[next].value);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(last, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(last); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[active].value); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
  }

  return (
    <div className="type-chip-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`type-chip ${value} ${className}`}
        aria-label={`${label}: ${current?.label ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        data-value={value}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="type-chip-label">{current?.label}</span>
        <ChevronDownIcon size={14} />
      </button>
      {open && (
        <ul className="type-chip-menu" role="listbox" id={listId} aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`type-chip-option ${o.value}${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.value)}
            >
              <span className="type-chip-dot" aria-hidden />
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
