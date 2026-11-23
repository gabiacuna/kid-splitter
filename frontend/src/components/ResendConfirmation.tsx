import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useT } from '../i18n';

const COOLDOWN_S = 60;

/** "Resend confirmation email" with a cooldown, so a teacher who didn't get (or lost)
 *  the link isn't stuck. Used after sign-up and when login says the email isn't confirmed. */
export default function ResendConfirmation({ email }: { email: string }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'limited'>('idle');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function resend() {
    setState('sending');
    try {
      await api.post('/auth/resend-confirmation', { email });
      setState('sent');
      setCooldown(COOLDOWN_S);
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } }).response?.status;
      setState(status === 429 ? 'limited' : 'error');
      if (status === 429) setCooldown(COOLDOWN_S);
    }
  }

  return (
    <div className="resend-confirmation" aria-live="polite">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={resend}
        disabled={!email || state === 'sending' || cooldown > 0}
      >
        {state === 'sending'
          ? t('Sending…')
          : cooldown > 0
            ? t('Resend available in {s}s', { s: cooldown })
            : t('Resend confirmation email')}
      </button>
      {state === 'sent' && <p className="resend-note">{t('Sent. It can take a few minutes — check your spam folder too.')}</p>}
      {state === 'limited' && <p className="resend-note error">{t('Too many emails requested. Wait a minute and try again.')}</p>}
      {state === 'error' && <p className="resend-note error">{t('Could not send the email. Try again.')}</p>}
    </div>
  );
}
