import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { translate } from '../i18n';

interface ToastItem {
  id: number;
  message: string;
  type: 'default' | 'error' | 'success';
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastItem['type']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Errors stay long enough to read (and have a close button); confirmations go quickly.
const DURATION_MS: Record<ToastItem['type'], number> = { error: 7000, success: 3500, default: 3500 };
const MAX_TOASTS = 3;

let _id = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastItem['type'] = 'default') => {
    const id = ++_id;
    setToasts((prev) => {
      const next = [...prev, { id, message, type }];
      // Drop the oldest beyond the cap.
      for (const old of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) {
        clearTimeout(timers.current.get(old.id));
        timers.current.delete(old.id);
      }
      return next.slice(-MAX_TOASTS);
    });
    timers.current.set(id, setTimeout(() => dismiss(id), DURATION_MS[type]));
  }, [dismiss]);

  useEffect(() => {
    const all = timers.current;
    return () => { all.forEach(clearTimeout); all.clear(); };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.type !== 'default' ? ` toast-${t.type}` : ''}`}>
            <span className="toast-msg">{t.message}</span>
            {t.type === 'error' && (
              <button type="button" className="toast-close" aria-label={translate('Close')} onClick={() => dismiss(t.id)}>
                <span aria-hidden>✕</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}
