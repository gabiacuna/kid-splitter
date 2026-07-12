import { createContext, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import type { Teacher } from '../lib/types';

interface AuthContextValue {
  teacher: Teacher | null;
  isLoading: boolean;
  setTeacher: (t: Teacher | null) => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/auth/me')
      .then((res) => setTeacher(res.data))
      .catch(() => setTeacher(null))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    function handleForceLogout() {
      setTeacher(null);
      navigate('/login');
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
    <AuthContext.Provider value={{ teacher, isLoading, setTeacher, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
