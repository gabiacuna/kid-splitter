import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../lib/api';
import { useToast } from './Toast';
import { useT } from '../i18n';
import Modal from './Modal';
import HelpTip from './HelpTip';

const SHARE_BASE = import.meta.env.VITE_SHARE_BASE_URL ?? window.location.origin;

interface Props {
  solutionId: string;
  shareEnabled: boolean;
  shareToken: string | null;
  onClose: () => void;
  onShareStateChange: (shareEnabled: boolean, token: string | null) => void;
}

export default function ShareModal({ solutionId, shareEnabled, shareToken, onClose, onShareStateChange }: Props) {
  const t = useT();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const url = shareToken ? `${SHARE_BASE}/share/${shareToken}` : '';

  const generateMutation = useMutation({
    mutationFn: () => api.post(`/solutions/${solutionId}/share`).then((r) => r.data),
    onSuccess: (data) => onShareStateChange(true, data.share_token),
    onError: () => showToast(t('Failed to generate link. Try again.'), 'error'),
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete(`/solutions/${solutionId}/share`).then((r) => r.data),
    onSuccess: () => { onShareStateChange(false, null); setConfirmRevoke(false); },
    onError: () => showToast(t('Failed to revoke. Try again.'), 'error'),
  });

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast(t('Copy the link above.'), 'default');
    }
  }

  return (
    <Modal
      title={<>{t('Share this class list')}<HelpTip text={t('Anyone with the link can see it without signing in.')} /></>}
      onClose={onClose}
      busy={generateMutation.isPending || revokeMutation.isPending}
    >

        {!shareEnabled ? (
          <>
            <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 20 }}>
              {t('Generate a link that anyone can use to view this class list. Recipients will see first names and class assignments only — no surnames or sensitive information.')}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? t('Generating…') : t('Generate link')}
            </button>
          </>
        ) : (
          <>
            <div className="share-url-row" style={{ marginBottom: 16 }}>
              <input
                type="text"
                value={url}
                readOnly
                aria-label={t('Share link')}
                className="share-url-input"
                onFocus={(e) => e.target.select()}
              />
              <button className="btn btn-primary" onClick={handleCopy} style={{ flexShrink: 0 }}>
                {copied ? t('Copied!') : t('Copy link')}
              </button>
            </div>
            <hr style={{ border: 'none', borderTop: '1.5px solid var(--border)', marginBottom: 16 }} />
            {confirmRevoke ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 13.5, color: 'var(--text2)' }}>{t('Are you sure?')}</span>
                <button className="btn btn-danger" onClick={() => revokeMutation.mutate()} disabled={revokeMutation.isPending}>
                  {revokeMutation.isPending ? t('Revoking…') : t('Revoke')}
                </button>
                <button className="btn btn-secondary" onClick={() => setConfirmRevoke(false)}>{t('Cancel')}</button>
              </div>
            ) : (
              <button className="btn btn-ghost" style={{ color: 'var(--coral)', borderColor: 'var(--coral)' }} onClick={() => setConfirmRevoke(true)}>
                {t('Revoke link')}
              </button>
            )}
            <p style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 10 }}>
              {t('Revoking this link will immediately prevent anyone from accessing it.')}
            </p>
          </>
        )}

        <div className="modal-footer" style={{ marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>{t('Close')}</button>
        </div>
    </Modal>
  );
}
