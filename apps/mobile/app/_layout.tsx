/**
 * Raíz de la app Volt: proveedores (identidad, idioma, área segura), fuentes de marca, avisos push y
 * el árbol de rutas con guardas: sin sesión → (auth); con sesión y consentimientos pendientes →
 * consents; con sesión → pestañas y pantallas de detalle.
 */
import {
  BarlowSemiCondensed_600SemiBold,
  BarlowSemiCondensed_700Bold,
  BarlowSemiCondensed_800ExtraBold_Italic,
} from '@expo-google-fonts/barlow-semi-condensed';
import { Roboto_400Regular, Roboto_500Medium } from '@expo-google-fonts/roboto';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth/auth.tsx';
import { I18nProvider, useI18n } from '../src/i18n/index.tsx';
import { configureNotificationHandler, registerForPush } from '../src/lib/notifications.ts';
import { colors, fonts } from '../src/theme/tokens.ts';
import { Loading } from '../src/theme/ui.tsx';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontsError] = useFonts({
    BarlowSemiCondensed_600SemiBold,
    BarlowSemiCondensed_700Bold,
    BarlowSemiCondensed_800ExtraBold_Italic,
    Roboto_400Regular,
    Roboto_500Medium,
  });
  const fontsReady = fontsLoaded || Boolean(fontsError);
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <LocalizedRoot fontsReady={fontsReady} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function LocalizedRoot({ fontsReady }: { fontsReady: boolean }) {
  const auth = useAuth();
  return (
    <I18nProvider onChange={(locale) => void auth.updateLocale(locale)}>
      <Root fontsReady={fontsReady} />
    </I18nProvider>
  );
}

function Root({ fontsReady }: { fontsReady: boolean }) {
  const auth = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    configureNotificationHandler();
  }, []);

  // Al abrir un aviso se va a la sesión que lo originó.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { sessionId?: string } | undefined;
      if (data?.sessionId) router.push(`/session/${data.sessionId}`);
    });
    return () => subscription.remove();
  }, [router]);

  // Registro del dispositivo para avisos push cuando el perfil está listo (una vez por cuenta).
  useEffect(() => {
    const profile = auth.profile;
    if (auth.status !== 'authenticated' || !profile || profile.pendingConsents.length > 0) return;
    if (registeredFor.current === profile.id) return;
    registeredFor.current = profile.id;
    void registerForPush(auth.api, locale);
  }, [auth.status, auth.profile, auth.api, locale]);

  const ready = fontsReady && (auth.status !== 'loading' || Boolean(auth.configError));
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!ready) return <Loading text={t('app.loading')} />;

  const signedIn = auth.status === 'authenticated';
  const needsVerify = signedIn && auth.profileError === 'EMAIL_NOT_VERIFIED';
  const needsConsent = signedIn && !needsVerify && (auth.profile?.pendingConsents.length ?? 0) > 0;
  const inApp = signedIn && !needsVerify && !needsConsent;

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.titleMedium, fontSize: 20 },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen
            name="verify-email"
            options={{ title: t('verify.title'), headerBackVisible: !needsVerify }}
          />
          <Stack.Protected guard={needsConsent}>
            <Stack.Screen
              name="consents"
              options={{ title: t('consent.title'), headerBackVisible: false }}
            />
          </Stack.Protected>
          <Stack.Protected guard={inApp}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="evse/[evseId]" options={{ title: t('evse.title') }} />
            <Stack.Screen name="session/[id]" options={{ title: t('session.title') }} />
            <Stack.Screen name="receipt/[id]" options={{ title: t('receipt.title') }} />
            <Stack.Screen name="payment-methods/index" options={{ title: t('payment.title') }} />
            <Stack.Screen name="payment-methods/new" options={{ title: t('payment.add') }} />
            <Stack.Screen name="payment-methods/[id]" options={{ title: t('payment.title') }} />
            <Stack.Screen name="debts" options={{ title: t('debt.title') }} />
            <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
            <Stack.Screen name="profile" options={{ title: t('account.profile') }} />
          </Stack.Protected>
        </Stack.Protected>
      </Stack>
    </>
  );
}
