/**
 * Raíz de la app Volt: proveedores (identidad, idioma, área segura), fuentes de marca, avisos push y
 * el árbol de rutas con guardas: sin sesión → (auth); con sesión y consentimientos pendientes →
 * consents; con sesión → pestañas y pantallas de detalle.
 */
import {
  BarlowSemiCondensed_500Medium,
  BarlowSemiCondensed_600SemiBold,
  BarlowSemiCondensed_700Bold,
  BarlowSemiCondensed_800ExtraBold,
  BarlowSemiCondensed_800ExtraBold_Italic,
} from '@expo-google-fonts/barlow-semi-condensed';
import { Roboto_400Regular, Roboto_500Medium, Roboto_700Bold } from '@expo-google-fonts/roboto';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { defaultApiBaseUrl } from '../src/api/client.ts';
import { AuthProvider, useAuth } from '../src/auth/auth.tsx';
import { deviceLocale, I18nProvider, translate, useI18n } from '../src/i18n/index.tsx';
import { appBuildInfo } from '../src/lib/app-updates.ts';
import {
  describeError,
  installGlobalErrorHandler,
  reportClientError,
} from '../src/lib/client-errors.ts';
import { configureNotificationHandler, registerForPush } from '../src/lib/notifications.ts';
import { ActiveSessionProvider } from '../src/session/active-session.tsx';
import { colors, fonts, spacing, text } from '../src/theme/tokens.ts';
import { Button, Loading } from '../src/theme/ui.tsx';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Informa un error a la API (mejor esfuerzo) con plataforma, versión y actualización en uso. */
function reportError(
  error: unknown,
  fatal: boolean,
  route: string | null = null,
): Promise<boolean> {
  const build = appBuildInfo();
  return reportClientError(
    defaultApiBaseUrl(),
    describeError(error, {
      route,
      platform: Platform.OS,
      appVersion: build.version,
      updateId: build.updateId,
      fatal,
    }),
  );
}

// Errores fatales fuera del árbol de React (promesas, temporizadores): se informan antes del cierre.
installGlobalErrorHandler((error, fatal) => reportError(error, fatal));

/**
 * Pantalla de error de expo-router para toda la app: en una app de tienda una excepción al dibujar
 * cerraría la app sin explicación; aquí se informa a la API y se ofrece reintentar. No depende de los
 * proveedores (idioma, identidad) porque puede dibujarse cuando ellos fallaron.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const locale = deviceLocale();
  const [detail, setDetail] = useState(false);
  useEffect(() => {
    void reportError(error, true);
  }, [error]);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.md,
      }}
    >
      <Text style={{ ...text.titulo2, color: colors.text, textAlign: 'center' }}>
        {translate(locale, 'crash.title')}
      </Text>
      <Text style={{ ...text.cuerpo, color: colors.textSecondary, textAlign: 'center' }}>
        {translate(locale, 'crash.body')}
      </Text>
      <Button title={translate(locale, 'crash.retry')} onPress={() => void retry()} />
      <Button
        title={translate(locale, 'crash.detail')}
        variant="ghost"
        onPress={() => setDetail((value) => !value)}
      />
      {detail ? (
        <ScrollView style={{ maxHeight: 220 }}>
          <Text style={{ ...text.cuerpoS, color: colors.textMuted }} selectable>
            {error.message}
            {error.stack ? `\n\n${error.stack.slice(0, 1500)}` : ''}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontsError] = useFonts({
    BarlowSemiCondensed_500Medium,
    BarlowSemiCondensed_600SemiBold,
    BarlowSemiCondensed_700Bold,
    BarlowSemiCondensed_800ExtraBold,
    BarlowSemiCondensed_800ExtraBold_Italic,
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_700Bold,
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
      <ActiveSessionProvider>
        <Root fontsReady={fontsReady} />
      </ActiveSessionProvider>
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

  // El invitado que crea su cuenta desde un cargador vuelve a ese cargador al terminar.
  const { returnTo, setReturnTo, status, profileError, profile } = auth;
  const phoneRequired = Boolean(auth.config?.phone.required);
  const canReturn =
    status === 'authenticated' &&
    profileError !== 'EMAIL_NOT_VERIFIED' &&
    (profile?.pendingConsents.length ?? 0) === 0 &&
    !(phoneRequired && profile && !profile.phoneVerified);
  useEffect(() => {
    if (!canReturn || !returnTo) return;
    setReturnTo(null);
    router.replace(returnTo as never);
  }, [canReturn, returnTo, setReturnTo, router]);

  if (!ready) return <Loading text={t('app.loading')} />;

  const signedIn = auth.status === 'authenticated';
  const needsVerify = signedIn && auth.profileError === 'EMAIL_NOT_VERIFIED';
  const needsConsent = signedIn && !needsVerify && (auth.profile?.pendingConsents.length ?? 0) > 0;
  // Celular verificado por SMS (ADR 0031): después de los consentimientos y antes de entrar.
  const needsPhone =
    signedIn &&
    !needsVerify &&
    !needsConsent &&
    phoneRequired &&
    Boolean(auth.profile) &&
    !auth.profile?.phoneVerified;
  const inApp = signedIn && !needsVerify && !needsConsent && !needsPhone;
  // Invitado: mapa, estaciones y escáner sin cuenta; el resto pide registro (handoff, sección 5).
  const browsing = inApp || (!signedIn && auth.guest);

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
        {/* Enlaces de los correos de identidad: pública, con o sin sesión (iteración 9). */}
        <Stack.Screen name="auth/action" options={{ headerShown: false }} />
        {/* Retorno del pago de un cobro pendiente (Wompi o checkout emulado): pública. */}
        <Stack.Screen name="pagos/retorno" options={{ headerShown: false }} />
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
          <Stack.Screen
            name="verify-phone"
            options={{ title: t('phone.title'), headerBackVisible: !needsPhone }}
          />
        </Stack.Protected>
        <Stack.Protected guard={browsing}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="station/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="history" options={{ headerShown: false }} />
          <Stack.Screen name="evse/[evseId]" options={{ headerShown: false }} />
          <Stack.Screen
            name="scan"
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Protected guard={inApp}>
            <Stack.Screen name="session/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="receipt/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="payment-methods/index" options={{ title: t('payment.title') }} />
            <Stack.Screen name="payment-methods/new" options={{ title: t('payment.add') }} />
            <Stack.Screen name="payment-methods/[id]" options={{ title: t('payment.title') }} />
            <Stack.Screen name="debts" options={{ title: t('debt.title') }} />
            <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
            <Stack.Screen name="profile" options={{ title: t('account.profile') }} />
            <Stack.Screen name="change-password" options={{ title: t('password.title') }} />
            <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
          </Stack.Protected>
        </Stack.Protected>
      </Stack>
    </>
  );
}
