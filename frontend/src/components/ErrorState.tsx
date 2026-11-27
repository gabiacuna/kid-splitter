import { useT } from '../i18n';

/** A failed load: icon, one plain sentence, and a retry button (usually the query's refetch). */
export default function ErrorState({ message, onRetry, retrying = false, compact = false }: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div className={`error-state${compact ? ' compact' : ''}`} role="alert">
      <span className="error-state-icon" aria-hidden>!</span>
      <p className="error-state-msg">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry} disabled={retrying}>
          {retrying ? t('Retrying…') : t('Retry')}
        </button>
      )}
    </div>
  );
}
