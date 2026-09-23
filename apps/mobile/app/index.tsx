import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/auth.tsx';

/** Punto de entrada: reparte según el estado de la identidad (las guardas del árbol hacen el resto). */
export default function Index() {
  const auth = useAuth();
  if (auth.status !== 'authenticated') return <Redirect href="/(auth)/sign-in" />;
  if (auth.profileError === 'EMAIL_NOT_VERIFIED') return <Redirect href="/verify-email" />;
  if ((auth.profile?.pendingConsents.length ?? 0) > 0) return <Redirect href="/consents" />;
  return <Redirect href="/(tabs)" />;
}
