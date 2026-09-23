/**
 * Identidad del personal en el back-office (SEG §3.1, ADR 0021).
 *
 * - Con Identity Platform: correo y contraseña con el SDK de Firebase (cargado bajo demanda), reto y
 *   alta de segundo factor TOTP, y el ID token en cada llamada a la API.
 * - Modo laboratorio: token estático `API_ADMIN_TOKEN` guardado en sessionStorage (solo esta pestaña).
 *
 * La API decide rol y permisos (`GET /admin/v1/me`); aquí solo se muestran u ocultan acciones.
 */
import type { Auth, MultiFactorResolver, TotpSecret, User } from 'firebase/auth';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiClient, ApiError } from '../lib/api.ts';
import { runtimeConfig } from '../lib/config.ts';

export interface AuthConfigPayload {
  provider: 'identity-platform' | 'token' | 'none';
  projectId: string | null;
  apiKey: string | null;
  authDomain: string | null;
  tokenLogin: boolean;
}

export interface Me {
  id: string | null;
  actor: string;
  tenantId: string;
  role: 'ADMIN' | 'OPERATIONS' | 'SUPPORT' | 'READ_ONLY' | 'SITE_OWNER';
  permissions: string[];
  siteIds: string[] | null;
  email: string | null;
  displayName: string | null;
  locale: 'es' | 'en';
  mfa: boolean;
  method: 'TOKEN' | 'IDENTITY_PLATFORM';
  authTime: string | null;
}

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'mfa-enroll';

export interface AuthState {
  status: AuthStatus;
  config: AuthConfigPayload | null;
  me: Me | null;
  /** Código de error para la pantalla de entrada (p. ej. STAFF_NOT_INVITED). */
  error: string | null;
  email: string | null;
}

export interface TotpEnrollment {
  secretKey: string;
  uri: string;
  finish: (code: string) => Promise<void>;
}

export interface AuthApi extends AuthState {
  api: ApiClient;
  can: (permission: string) => boolean;
  signInWithPassword: (email: string, password: string) => Promise<MultiFactorResolver | null>;
  resolveMfa: (resolver: MultiFactorResolver, code: string) => Promise<void>;
  signInWithToken: (token: string, actor?: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
  startTotpEnrollment: (password?: string) => Promise<TotpEnrollment>;
  resendVerification: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const TOKEN_KEY = 'volt.adminToken';
const ACTOR_KEY = 'volt.adminActor';
const AuthContext = createContext<AuthApi | null>(null);

type FirebaseAuthModule = typeof import('firebase/auth');

interface FirebaseHandle {
  auth: Auth;
  mod: FirebaseAuthModule;
}

async function loadFirebase(config: AuthConfigPayload): Promise<FirebaseHandle> {
  const [{ initializeApp, getApps, getApp }, mod] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ]);
  const app =
    getApps().length > 0
      ? getApp()
      : initializeApp({
          ...(config.apiKey ? { apiKey: config.apiKey } : {}),
          ...(config.authDomain ? { authDomain: config.authDomain } : {}),
          ...(config.projectId ? { projectId: config.projectId } : {}),
        });
  return { auth: mod.getAuth(app), mod };
}

function readStoredToken(): { token: string; actor: string | null } | null {
  try {
    const token = window.sessionStorage.getItem(TOKEN_KEY);
    return token ? { token, actor: window.sessionStorage.getItem(ACTOR_KEY) } : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    config: null,
    me: null,
    error: null,
    email: null,
  });
  const firebase = useRef<FirebaseHandle | null>(null);
  const stored = useRef<{ token: string; actor: string | null } | null>(readStoredToken());
  const stateRef = useRef(state);
  stateRef.current = state;

  const tokenProvider = useCallback(async (): Promise<string | null> => {
    if (stored.current) return stored.current.token;
    const user = firebase.current?.auth.currentUser;
    return user ? user.getIdToken() : null;
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: runtimeConfig().apiBaseUrl,
        token: tokenProvider,
        headers: () => (stored.current?.actor ? { 'x-actor': stored.current.actor } : {}),
        onUnauthorized: (error) => {
          if (stateRef.current.status !== 'authenticated') return;
          if (stored.current) {
            stored.current = null;
            try {
              window.sessionStorage.removeItem(TOKEN_KEY);
            } catch {
              // nada
            }
          }
          setState((s) => ({ ...s, status: 'anonymous', me: null, error: error.code }));
        },
      }),
    [tokenProvider],
  );

  /** Pide /me y resuelve el estado según la respuesta de la API. */
  const loadMe = useCallback(
    async (email: string | null): Promise<void> => {
      try {
        const me = await api.get<Me>('/me');
        setState((s) => ({
          ...s,
          status: 'authenticated',
          me,
          error: null,
          email: me.email ?? email,
        }));
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'NETWORK';
        if (code === 'MFA_REQUIRED') {
          setState((s) => ({ ...s, status: 'mfa-enroll', me: null, error: null, email }));
          return;
        }
        if (stored.current) {
          stored.current = null;
          try {
            window.sessionStorage.removeItem(TOKEN_KEY);
          } catch {
            // nada
          }
        } else if (code !== 'EMAIL_NOT_VERIFIED' && firebase.current) {
          await firebase.current.mod.signOut(firebase.current.auth);
        }
        setState((s) => ({ ...s, status: 'anonymous', me: null, error: code, email }));
      }
    },
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      let config: AuthConfigPayload;
      try {
        config = await api.get<AuthConfigPayload>('/auth/config');
      } catch {
        config = {
          provider: 'none',
          projectId: null,
          apiKey: null,
          authDomain: null,
          tokenLogin: false,
        };
      }
      if (cancelled) return;
      setState((s) => ({ ...s, config }));
      if (stored.current) {
        await loadMe(null);
        return;
      }
      if (config.provider === 'identity-platform' && config.apiKey) {
        const handle = await loadFirebase(config);
        if (cancelled) return;
        firebase.current = handle;
        let first = true;
        unsubscribe = handle.mod.onIdTokenChanged(handle.auth, (user: User | null) => {
          if (user) {
            if (first || stateRef.current.status !== 'authenticated') void loadMe(user.email);
          } else if (first || stateRef.current.status !== 'anonymous') {
            setState((s) => ({ ...s, status: 'anonymous', me: null }));
          }
          first = false;
        });
        return;
      }
      setState((s) => ({ ...s, status: 'anonymous' }));
    })().catch((error: unknown) => {
      if (!cancelled)
        setState((s) => ({ ...s, status: 'anonymous', error: (error as Error).message }));
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [api, loadMe]);

  const requireFirebase = (): FirebaseHandle => {
    if (!firebase.current) throw new Error('Identity Platform no está configurado');
    return firebase.current;
  };

  const value: AuthApi = {
    ...state,
    api,
    can: (permission) => state.me?.permissions.includes(permission) ?? false,
    signInWithPassword: async (email, password) => {
      const { auth, mod } = requireFirebase();
      setState((s) => ({ ...s, error: null, email }));
      try {
        await mod.signInWithEmailAndPassword(auth, email, password);
        return null;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'auth/multi-factor-auth-required') {
          return mod.getMultiFactorResolver(auth, error as never);
        }
        throw error;
      }
    },
    resolveMfa: async (resolver, code) => {
      const { mod } = requireFirebase();
      const hint = resolver.hints.find(
        (h) => h.factorId === mod.TotpMultiFactorGenerator.FACTOR_ID,
      );
      if (!hint) throw new Error('La cuenta no tiene TOTP inscrito');
      const assertion = mod.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
      await resolver.resolveSignIn(assertion);
    },
    signInWithToken: async (token, actor) => {
      const value = token.trim();
      stored.current = { token: value, actor: actor?.trim() || null };
      try {
        window.sessionStorage.setItem(TOKEN_KEY, value);
        if (actor?.trim()) window.sessionStorage.setItem(ACTOR_KEY, actor.trim());
        else window.sessionStorage.removeItem(ACTOR_KEY);
      } catch {
        // sin almacenamiento
      }
      await loadMe(null);
    },
    signOut: async () => {
      stored.current = null;
      try {
        window.sessionStorage.removeItem(TOKEN_KEY);
        window.sessionStorage.removeItem(ACTOR_KEY);
      } catch {
        // nada
      }
      if (firebase.current) await firebase.current.mod.signOut(firebase.current.auth);
      setState((s) => ({ ...s, status: 'anonymous', me: null, error: null }));
    },
    reload: async () => {
      await loadMe(state.email);
    },
    startTotpEnrollment: async (password) => {
      const { auth, mod } = requireFirebase();
      const user = auth.currentUser;
      if (!user) throw new Error('Sin sesión de Identity Platform');
      if (password && user.email) {
        await mod.reauthenticateWithCredential(
          user,
          mod.EmailAuthProvider.credential(user.email, password),
        );
      }
      const session = await mod.multiFactor(user).getSession();
      const secret: TotpSecret = await mod.TotpMultiFactorGenerator.generateSecret(session);
      return {
        secretKey: secret.secretKey,
        uri: secret.generateQrCodeUrl(user.email ?? 'volt', 'Volt back-office'),
        finish: async (code: string) => {
          const assertion = mod.TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
          await mod.multiFactor(user).enroll(assertion, 'Autenticador');
        },
      };
    },
    resendVerification: async () => {
      const { auth, mod } = requireFirebase();
      if (auth.currentUser) await mod.sendEmailVerification(auth.currentUser);
    },
    resetPassword: async (email) => {
      const { auth, mod } = requireFirebase();
      await mod.sendPasswordResetEmail(auth, email);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider ausente');
  return context;
}

/** Cliente de API de la sesión actual (atajo). */
export function useApi(): ApiClient {
  return useAuth().api;
}

/** Actor que declara el modo token (X-Actor) para la auditoría del laboratorio. */
export function storedActor(): string | null {
  return readStoredToken()?.actor ?? null;
}
