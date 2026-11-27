import { Component, type ReactNode } from 'react';
import { translate } from '../i18n';

/** Last line of defence: a render crash shows a plain screen with "Reload" instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Unhandled render error', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }} role="alert">
          <h1 className="auth-title">{translate('Something went wrong')}</h1>
          <p style={{ color: 'var(--text2)', margin: '8px 0 20px' }}>
            {translate('The page hit an unexpected problem. Reloading usually fixes it.')}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            {translate('Reload')}
          </button>
        </div>
      </div>
    );
  }
}
