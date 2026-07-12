import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../lib/api';
import { useToast } from './Toast';

const SHARE_BASE = import.meta.env.VITE_SHARE_BASE_URL ?? window.location.origin;

interface Props {
  solutionId: string;
  shareEnabled: boolean;
  shareToken: string | null;
  onClose: () => void;
  onShareStateChange: (shareEnabled: boolean, token: string | null) => void;
}

export default function ShareModal({ solutionId, shareEnabled, shareToken, onClose, onShareStateChange }: Props) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const url = shareToken ? `${SHARE_BASE}/share/${shareToken}` : '';

  const generateMutation = useMutation({
    mutationFn: () => api.post(`/solutions/${solutionId}/share`).then((r) => r.data),
    onSuccess: (data) => onShareStateChange(true, data.share_token),
    onError: () => showToast('Failed to generate link. Try again.', 'error'),
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete(`/solutions/${solutionId}/share`).then((r) => r.data),
    onSuccess: () => { onShareStateChange(false, null); setConfirmRevoke(false); },
    onError: () => showToast('Failed to revoke. Try again.', 'error'),
  });

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Copy the link above.', 'default');
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">Share this class list</h2>

        {!shareEnabled ? (
          <>
            <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 20 }}>
              Generate a link that anyone can use to view this class list. Recipients will see first names and class assignments only — no surnames or sensitive information.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? 'Generating…' : 'Generate link'}
            </button>
          </>
        ) : (
          <>
            <div className="share-url-row" style={{ marginBottom: 16 }}>
              <input
                type="text"
                value={url}
                readOnly
                className="share-url-input"
                onFocus={(e) => e.target.select()}
              />
              <button className="btn btn-primary" onClick={handleCopy} style={{ flexShrink: 0 }}>
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
            <hr style={{ border: 'none', borderTop: '1.5px solid var(--border)', marginBottom: 16 }} />
            {confirmRevoke ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 13.5, color: 'var(--text2)' }}>Are you sure?</span>
                <button className="btn btn-danger" onClick={() => revokeMutation.mutate()} disabled={revokeMutation.isPending}>
                  {revokeMutation.isPending ? 'Revoking…' : 'Revoke'}
                </button>
                <button className="btn btn-secondary" onClick={() => setConfirmRevoke(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn btn-ghost" style={{ color: 'var(--coral)', borderColor: 'var(--coral)' }} onClick={() => setConfirmRevoke(true)}>
                Revoke link
              </button>
            )}
            <p style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 10 }}>
              Revoking this link will immediately prevent anyone from accessing it.
            </p>
          </>
        )}

        <div className="modal-footer" style={{ marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
