import { createContext, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { httpStatus } from '../lib/errors';
import type { Teacher } from '../lib/types';

/**
 * - `loading`: first /auth/me in flight.
 * - `ready`: we know who is signed in (`teacher` may be null = signed out).
 * - `unreachable`: the backend didn't answer (network or 5xx). This is *not* "signed out":
 *   protected pages show a connection error with retry instead of bouncing to /login.
 */
export type AuthStatus = 'loading' | 'ready' | 'unreachable';

interface AuthContextValue {
  teacher: Teacher | null;
  isLoading: boolean;
  status: AuthStatus;
  setTeacher: (t: Teacher | null) => void;
  logout: () => Promise<void>;
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** `/auth/me`, refreshing the session once on 401. Resolves null only when signed out. */
async function fetchMe(): Promise<Teacher | null> {
  try {
    return (await api.get('/auth/me')).data;
  } catch (err) {
    if (httpStatus(err) !== 401) throw err;
  }
  try {
    await api.post('/auth/refresh');
  } catch (err) {
    if (httpStatus(err) === 401) return null; // refresh token missing/expired: signed out
    throw err;
  }
  try {
    return (await api.get('/auth/me')).data;
  } catch (err) {
    if (httpStatus(err) === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((me) => { if (!cancelled) { setTeacher(me); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('unreachable'); });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = useCallback(() => { setStatus('loading'); setAttempt((a) => a + 1); }, []);

  useEffect(() => {
    // Fired by the api client when a refresh fails mid-session.
    function handleForceLogout() {
      setTeacher(null);
      navigate('/login', { state: { sessionExpired: true } });
    }
    window.addEventListener('auth:logout', handleForceLogout);
    return () => window.removeEventListener('auth:logout', handleForceLogout);
  }, [navigate]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    setTeacher(null);
    navigate('/login');
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ teacher, isLoading: status === 'loading', status, setTeacher, logout, retry }}>
      {children}
    </AuthContext.Provider>
  );
}
