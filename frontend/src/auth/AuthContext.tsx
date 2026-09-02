import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import { disconnectSocket } from '../realtime/socket';

export interface AuthUser {
  id: string;
  username: string;
  role: 'user' | 'admin';
  canCreateInvites: boolean;
}

interface AuthState {
  accessToken: string;
  user: AuthUser;
}

interface AuthContextValue {
  auth: AuthState | null;
  login: (usernameOrEmail: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const STORAGE_KEY = 'bloeki_auth';

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredAuth(): AuthState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthState) : null;
  } catch {
    return null;
  }
}

function clearStoredAuth() {
  window.localStorage.removeItem(STORAGE_KEY);
  disconnectSocket();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(() => readStoredAuth());

  // A stale/invalidated token (see api.ts's 401 handling - e.g. after a dev
  // DB reset, or a token that outlives a deleted/blocked account) should
  // drop the app back to "please log in" everywhere, not leave every page
  // stuck showing whatever error it happened to catch locally.
  useEffect(() => {
    function handleUnauthorized() {
      clearStoredAuth();
      setAuth(null);
    }
    window.addEventListener('bloeki:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('bloeki:unauthorized', handleUnauthorized);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      async login(usernameOrEmail: string, password: string) {
        const result = await apiFetch<{ accessToken: string; user: AuthUser }>('/auth/login', {
          method: 'POST',
          body: { usernameOrEmail, password },
        });
        const next: AuthState = { accessToken: result.accessToken, user: result.user };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setAuth(next);
        return result.user;
      },
      logout() {
        clearStoredAuth();
        setAuth(null);
      },
    }),
    [auth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
