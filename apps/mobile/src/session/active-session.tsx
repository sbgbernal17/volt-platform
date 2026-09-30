/**
 * Sesión de carga en curso del conductor (para el botón Cargar de la barra y el mapa): sondea el
 * historial reciente cada 15 s mientras hay identidad y se refresca a mano al iniciar o detener.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '../api/types.ts';
import { useAuth } from '../auth/auth.tsx';

export const OPEN_STATES = new Set<Session['state']>([
  'REQUESTED',
  'STARTING',
  'ACTIVE',
  'STOPPING',
]);

interface ActiveSessionState {
  session: Session | null;
  refresh: () => Promise<void>;
}

const ActiveSessionContext = createContext<ActiveSessionState>({
  session: null,
  refresh: async () => undefined,
});

export function pickActiveSession(items: Session[]): Session | null {
  return items.find((item) => OPEN_STATES.has(item.state)) ?? null;
}

export function ActiveSessionProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const enabled = auth.status === 'authenticated' && Boolean(auth.profile);
  const refresh = useCallback(async () => {
    if (!enabled) {
      setSession(null);
      return;
    }
    try {
      const result = await auth.api.get<{ items: Session[] }>('/sessions', { limit: 5 });
      setSession(pickActiveSession(result.items));
    } catch {
      // Sin red: se conserva lo último conocido.
    }
  }, [auth.api, enabled]);
  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh, enabled]);
  const value = useMemo(() => ({ session, refresh }), [session, refresh]);
  return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}

export function useActiveSession(): ActiveSessionState {
  return useContext(ActiveSessionContext);
}
