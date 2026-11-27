import type { ReactNode } from 'react';
import { Logo } from './Nav';
import LangToggle from './LangToggle';

/** Card layout shared by the signed-out pages, with the language switch they used to lack. */
export default function AuthShell({ children, center = false, logo = true }: { children: ReactNode; center?: boolean; logo?: boolean }) {
  return (
    <div className="auth-page">
      <div className="auth-lang"><LangToggle /></div>
      <main className="auth-card" style={center ? { textAlign: 'center' } : undefined}>
        {logo && <Logo style={{ marginBottom: 24, justifyContent: center ? 'center' : undefined }} />}
        {children}
      </main>
    </div>
  );
}
