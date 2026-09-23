/**
 * Estado de identidad de la app (ADR 0022): carga la configuración pública (`GET /v1/config`), inicia
 * sesión con Identity Platform (correo y contraseña) o con la identidad de desarrollo, mantiene el
 * perfil (`GET /v1/me`) y expone las acciones de cuenta (verificación de correo, consentimientos,
 * cierre de sesión, borrado).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Auth, User } from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
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
import { ApiClient, ApiError, defaultApiBaseUrl } from '../api/client.ts';
import type { AppConfig, ConsentKey, Profile } from '../api/types.ts';
import { createAuth, isRecentLoginError } from './firebase.ts';

const DEV_TOKEN_KEY = 'volt.devToken';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  config: AppConfig | null;
  configError: unknown;
  reloadConfig: () => Promise<void>;
  api: ApiClient;
  profile: Profile | null;
  /** Código del error al cargar el perfil (p. ej. EMAIL_NOT_VERIFIED al vincular una cuenta). */
  profileError: string | null;
  /** Correo de la identidad (Identity Platform) aunque el perfil no haya cargado. */
  email: string | null;
  emailVerifiedInIdp: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signInDev: (driverId: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Recarga el usuario y el token y vuelve a leer el perfil; devuelve si el correo ya está verificado. */
  checkVerification: () => Promise<boolean>;
  refreshProfile: () => Promise<Profile | null>;
  acceptConsents: (keys: ConsentKey[], locale: 'es' | 'en') => Promise<Profile>;
  updateLocale: (locale: 'es' | 'en') => Promise<void>;
  deleteAccount: () => Promise<'deleted' | 'relogin'>;
}

const AuthContext = createContext<AuthState | null>(null);

function requireAuth(ref: { current: Auth | null }): Auth {
  const auth = ref.current;
  if (!auth) throw new Error('identity-unavailable');
  return auth;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<unknown>(undefined);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const authRef = useRef<Auth | null>(null);
  const baseUrl = useMemo(() => defaultApiBaseUrl(), []);

  const tokenProvider = useCallback(async () => {
    if (devToken) return devToken;
    const current = authRef.current?.currentUser;
    return current ? current.getIdToken() : null;
  }, [devToken]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl,
        token: tokenProvider,
        onUnauthorized: (error) => {
          // Token de desarrollo caducado o cuenta eliminada: se vuelve al inicio.
          if (devToken && error.code === 'UNAUTHORIZED') {
            AsyncStorage.removeItem(DEV_TOKEN_KEY).catch(() => undefined);
            setDevToken(null);
          }
        },
      }),
    [baseUrl, tokenProvider, devToken],
  );
  const publicApi = useMemo(() => new ApiClient({ baseUrl, token: async () => null }), [baseUrl]);

  const loadConfig = useCallback(async () => {
    try {
      const loaded = await publicApi.get<AppConfig>('/config');
      setConfig(loaded);
      setConfigError(undefined);
    } catch (error) {
      setConfigError(error);
    }
  }, [publicApi]);

  useEffect(() => {
    void loadConfig();
    AsyncStorage.getItem(DEV_TOKEN_KEY)
      .then((stored) => {
        if (stored?.startsWith('dev:')) setDevToken(stored);
      })
      .catch(() => undefined);
  }, [loadConfig]);

  // Identity Platform: se inicializa cuando llega la configuración.
  useEffect(() => {
    if (
      config?.auth.provider !== 'identity-platform' ||
      !config.auth.apiKey ||
      !config.auth.projectId
    ) {
      if (config) setStatus((current) => (current === 'loading' ? 'anonymous' : current));
      return;
    }
    const auth = createAuth({
      apiKey: config.auth.apiKey,
      authDomain: config.auth.authDomain,
      projectId: config.auth.projectId,
      tenantId: config.auth.tenantId,
    });
    authRef.current = auth;
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      setUser(next);
      if (!next) {
        setProfile(null);
        setProfileError(null);
      }
      setStatus((current) =>
        next ? 'authenticated' : devToken && current !== 'loading' ? current : 'anonymous',
      );
    });
    return unsubscribe;
  }, [config, devToken]);

  useEffect(() => {
    if (devToken) setStatus('authenticated');
    else if (config && !user) setStatus('anonymous');
  }, [devToken, config, user]);

  const refreshProfile = useCallback(async (): Promise<Profile | null> => {
    try {
      const me = await api.get<Profile>('/me');
      setProfile(me);
      setProfileError(null);
      return me;
    } catch (error) {
      setProfile(null);
      setProfileError(error instanceof ApiError ? error.code : 'NETWORK');
      return null;
    }
  }, [api]);

  useEffect(() => {
    if (status === 'authenticated') void refreshProfile();
  }, [status, refreshProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(requireAuth(authRef), email.trim(), password);
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const credential = await createUserWithEmailAndPassword(
      requireAuth(authRef),
      email.trim(),
      password,
    );
    if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
    await sendEmailVerification(credential.user).catch(() => undefined);
  }, []);

  const signInDev = useCallback(async (driverId: string) => {
    const token = `dev:${driverId.trim()}`;
    await AsyncStorage.setItem(DEV_TOKEN_KEY, token);
    setDevToken(token);
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(DEV_TOKEN_KEY).catch(() => undefined);
    setDevToken(null);
    setProfile(null);
    setProfileError(null);
    if (authRef.current?.currentUser) await firebaseSignOut(authRef.current);
    setStatus('anonymous');
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(requireAuth(authRef), email.trim());
  }, []);

  const resendVerification = useCallback(async () => {
    const current = authRef.current?.currentUser;
    if (current) await sendEmailVerification(current);
  }, []);

  const checkVerification = useCallback(async () => {
    const current = authRef.current?.currentUser;
    if (!current) return false;
    await current.reload();
    await current.getIdToken(true);
    setUser(authRef.current?.currentUser ?? null);
    const me = await refreshProfile();
    return Boolean(me?.emailVerified);
  }, [refreshProfile]);

  const acceptConsents = useCallback(
    async (keys: ConsentKey[], locale: 'es' | 'en') => {
      const me = await api.post<Profile>('/me/consents', { accept: keys, locale });
      setProfile(me);
      return me;
    },
    [api],
  );

  const updateLocale = useCallback(
    async (locale: 'es' | 'en') => {
      if (status !== 'authenticated' || !profile || profile.locale === locale) return;
      try {
        setProfile(await api.patch<Profile>('/me', { locale }));
      } catch {
        // sin red: se reintenta en el siguiente cambio
      }
    },
    [api, status, profile],
  );

  const deleteAccount = useCallback(async (): Promise<'deleted' | 'relogin'> => {
    await api.post('/me/delete', { confirm: true });
    const current = authRef.current?.currentUser;
    if (current) {
      try {
        await deleteUser(current);
      } catch (error) {
        if (isRecentLoginError(error)) {
          await signOut();
          return 'relogin';
        }
      }
    }
    await signOut();
    return 'deleted';
  }, [api, signOut]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      config,
      configError,
      reloadConfig: loadConfig,
      api,
      profile,
      profileError,
      email: user?.email ?? profile?.email ?? null,
      emailVerifiedInIdp: user?.emailVerified ?? false,
      signIn,
      signUp,
      signInDev,
      signOut,
      resetPassword,
      resendVerification,
      checkVerification,
      refreshProfile,
      acceptConsents,
      updateLocale,
      deleteAccount,
    }),
    [
      status,
      config,
      configError,
      loadConfig,
      api,
      profile,
      profileError,
      user,
      signIn,
      signUp,
      signInDev,
      signOut,
      resetPassword,
      resendVerification,
      checkVerification,
      refreshProfile,
      acceptConsents,
      updateLocale,
      deleteAccount,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useAuth fuera de AuthProvider');
  return state;
}
