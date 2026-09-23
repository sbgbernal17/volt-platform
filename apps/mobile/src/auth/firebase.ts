/**
 * Identity Platform (SDK de Firebase) en la app: persistencia en AsyncStorage en iOS y Android y en el
 * navegador en la web; tenant de conductores opcional (`firebase.tenant` del ID token, ADR 0022).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import { Platform } from 'react-native';

type RnPersistence = (storage: typeof AsyncStorage) => firebaseAuth.Persistence;

export function createAuth(options: {
  apiKey: string;
  authDomain: string | null;
  projectId: string;
  tenantId: string | null;
}): firebaseAuth.Auth {
  const app: FirebaseApp = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: options.apiKey,
        projectId: options.projectId,
        ...(options.authDomain ? { authDomain: options.authDomain } : {}),
      });
  let auth: firebaseAuth.Auth;
  if (Platform.OS === 'web') {
    auth = firebaseAuth.getAuth(app);
  } else {
    // El punto de entrada de React Native exporta getReactNativePersistence; en los tipos comunes no aparece.
    const rnPersistence = (firebaseAuth as unknown as { getReactNativePersistence?: RnPersistence })
      .getReactNativePersistence;
    try {
      auth = firebaseAuth.initializeAuth(app, {
        ...(rnPersistence ? { persistence: rnPersistence(AsyncStorage) } : {}),
      });
    } catch {
      auth = firebaseAuth.getAuth(app);
    }
  }
  auth.tenantId = options.tenantId;
  return auth;
}

/** Código de error de Firebase → clave de texto de la app. */
export function authErrorKey(
  error: unknown,
):
  | 'auth.error.invalid'
  | 'auth.error.exists'
  | 'auth.error.weak'
  | 'auth.error.network'
  | 'auth.error.tooMany'
  | 'auth.error.generic' {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
    case 'auth/user-disabled':
      return 'auth.error.invalid';
    case 'auth/email-already-in-use':
      return 'auth.error.exists';
    case 'auth/weak-password':
      return 'auth.error.weak';
    case 'auth/network-request-failed':
      return 'auth.error.network';
    case 'auth/too-many-requests':
      return 'auth.error.tooMany';
    default:
      return 'auth.error.generic';
  }
}

export function isRecentLoginError(error: unknown): boolean {
  return (error as { code?: string })?.code === 'auth/requires-recent-login';
}
