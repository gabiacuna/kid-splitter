import { useEffect, useState } from 'react';
import { API_BASE, NETWORK_ERROR_EVENT, NETWORK_OK_EVENT } from '../lib/api';
import { useT } from '../i18n';

const POLL_MS = 5000;

/**
 * "We can't reach the server" bar. Shows when the browser goes offline or a request gets
 * no response; while shown it polls /api/health and hides as soon as the backend answers.
 */
export default function ConnectionBanner() {
  const t = useT();
  const [down, setDown] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const goDown = () => setDown(true);
    const goUp = () => setDown(false);
    window.addEventListener('offline', goDown);
    window.addEventListener(NETWORK_ERROR_EVENT, goDown);
    window.addEventListener(NETWORK_OK_EVENT, goUp);
    return () => {
      window.removeEventListener('offline', goDown);
      window.removeEventListener(NETWORK_ERROR_EVENT, goDown);
      window.removeEventListener(NETWORK_OK_EVENT, goUp);
    };
  }, []);

  useEffect(() => {
    if (!down) return;
    let cancelled = false;
    async function check() {
      setChecking(true);
      try {
        // Plain fetch: going through the api client would re-trigger the banner events.
        const res = await fetch(`${API_BASE}/health`, { cache: 'no-store', credentials: 'omit' });
        if (!cancelled && res.ok) setDown(false);
      } catch { /* still down */ } finally {
        if (!cancelled) setChecking(false);
      }
    }
    const id = setInterval(check, POLL_MS);
    window.addEventListener('online', check);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('online', check); };
  }, [down]);

  if (!down) return null;
  return (
    <div className="connection-banner" role="alert">
      <span aria-hidden>⚠</span>
      <span>{t('We can’t connect to the server. We’ll keep trying — your changes on screen are kept.')}</span>
      {checking && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} aria-hidden />}
    </div>
  );
}
