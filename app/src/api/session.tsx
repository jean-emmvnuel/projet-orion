import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, ApiError, getCoreUrl, loadCoreUrl, loadToken, saveCoreUrl, saveToken, setUnauthorizedHandler } from './client';
import { connectLive, resetLive } from './live';
import type { User } from './types';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface Session {
  status: Status;
  user: User | null;
  coreUrl: string;
  setCoreUrl: (url: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface AuthResponse {
  message: string;
  data: { user: User; token: string } | null;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Session ORION : jeton dans le trousseau, renouvelé à chaque ouverture de l'app
 * (le Core délivre des jetons de 7 jours), et canal temps réel ouvert tant qu'on est connecté.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [coreUrl, setUrl] = useState(getCoreUrl());

  const signOut = useCallback(async () => {
    resetLive();
    await saveToken(null).catch(() => {});
    setUser(null);
    setStatus('signedOut');
  }, []);

  const accept = useCallback(async (res: AuthResponse) => {
    if (!res.data) throw new ApiError('Ce compte existe peut-être déjà : essaie de te connecter.', 409);
    await saveToken(res.data.token);
    setUser(res.data.user);
    setStatus('signedIn');
    connectLive();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    (async () => {
      setUrl(await loadCoreUrl());
      const token = await loadToken();
      if (!token) return setStatus('signedOut');
      try {
        await accept(await api<AuthResponse>('/auth/refresh', { body: {} }));
      } catch (e) {
        // Hors ligne : on garde la session, l'app réessaiera ; jeton refusé : déconnexion.
        if (e instanceof ApiError && e.status === 0) {
          setStatus('signedIn');
          connectLive();
        } else await signOut();
      }
    })();
  }, [accept, signOut]);

  const value = useMemo<Session>(
    () => ({
      status,
      user,
      coreUrl,
      setCoreUrl: async (url) => {
        await saveCoreUrl(url);
        setUrl(getCoreUrl());
      },
      login: async (email, password) => accept(await api<AuthResponse>('/auth/login', { body: { email, password } })),
      register: async (username, email, password) => accept(await api<AuthResponse>('/auth/register', { body: { username, email, password } })),
      logout: signOut,
    }),
    [status, user, coreUrl, accept, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession doit être utilisé sous <SessionProvider>');
  return ctx;
}
