/**
 * Cuenta (handoff, pantalla 18): encabezado con el único degradado de la marca, avatar con
 * iniciales, accesos rápidos (actividad, medios de pago, cobros pendientes, avisos), filas de perfil, idioma,
 * legal, soporte y cierre de sesión; borrado de cuenta al final. El invitado ve la invitación a
 * crear cuenta.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Billing } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { pushSupported, registerForPush, unregisterPush } from '../../src/lib/notifications.ts';
import { Icon, type IconName } from '../../src/theme/icon.tsx';
import {
  colors,
  fonts,
  headerGradient,
  radius,
  spacing,
  type Tone,
  text,
  toneColors,
} from '../../src/theme/tokens.ts';
import { Badge, Button, ListRow, Muted, Note, Notice, Screen } from '../../src/theme/ui.tsx';

function confirm(title: string, message: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export function initials(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const source = (name ?? '').trim() || (email ?? '').split('@')[0] || '';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : source.slice(0, 2);
  return letters.toUpperCase() || 'V';
}

function QuickAccess({
  icon,
  tone,
  label,
  badge,
  onPress,
}: {
  icon: IconName;
  tone: Tone;
  label: string;
  badge?: number | undefined;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quick, pressed && { borderColor: colors.handle }]}
    >
      <View style={[styles.quickIcon, { backgroundColor: toneColors[tone].bg }]}>
        <Icon name={icon} size={22} color={toneColors[tone].fg} />
        {badge ? (
          <View style={styles.quickBadge}>
            <Text style={styles.quickBadgeText}>{badge > 9 ? '9+' : String(badge)}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

export default function Account() {
  const { t, locale, setLocale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signedIn = auth.status === 'authenticated';
  const [message, setMessage] = useState<{
    tone: 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);
  const billing = useQuery(() => auth.api.get<Billing>('/billing'), [signedIn], {
    enabled: signedIn,
    intervalMs: 30_000,
  });
  const unread = useQuery(
    () => auth.api.get<{ unread: number }>('/me/notifications', { limit: 1 }),
    [signedIn],
    { enabled: signedIn, intervalMs: 30_000 },
  );
  const profile = auth.profile;
  const openDebts = billing.data?.debts.filter((d) => d.status === 'OPEN').length ?? 0;
  const legal = auth.config?.legal;
  const support = legal?.supportEmail ?? null;

  const enablePush = async () => {
    const result = await registerForPush(auth.api, locale);
    if (result.ok) setMessage({ tone: 'success', text: t('notifications.enabled') });
    else if (result.reason === 'unsupported' || result.reason === 'no-project')
      setMessage({ tone: 'warning', text: t('notifications.notSupported') });
    else setMessage({ tone: 'warning', text: t('notifications.permission') });
  };
  const signOut = async () => {
    await unregisterPush(auth.api);
    await auth.signOut();
  };
  const remove = async () => {
    if (
      !(await confirm(
        t('account.delete'),
        t('account.deleteConfirm'),
        t('account.delete'),
        t('app.cancel'),
      ))
    )
      return;
    try {
      const outcome = await auth.deleteAccount();
      setMessage({
        tone: 'success',
        text: outcome === 'relogin' ? t('account.deleteRelogin') : t('account.deleted'),
      });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'ERROR';
      setMessage({
        tone: 'danger',
        text:
          code === 'ACTIVE_SESSION'
            ? t('account.deleteBlocked.ACTIVE_SESSION')
            : code === 'DEBT_PENDING'
              ? t('account.deleteBlocked.DEBT_PENDING')
              : t('app.error'),
      });
    }
  };

  const header = (
    <LinearGradient
      colors={[...headerGradient]}
      style={[styles.header, { paddingTop: insets.top + spacing.xxl }]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {signedIn ? initials(profile?.displayName, profile?.email ?? auth.email) : 'V'}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name} numberOfLines={1}>
          {signedIn
            ? (profile?.displayName ?? auth.email ?? t('account.profile'))
            : t('account.guestTitle')}
        </Text>
        <Text style={styles.email} numberOfLines={1}>
          {signedIn ? (profile?.email ?? auth.email ?? '') : t('account.guestBody')}
        </Text>
      </View>
    </LinearGradient>
  );

  if (!signedIn) {
    return (
      <Screen dense padded={false}>
        {header}
        <View style={{ paddingHorizontal: spacing.list, gap: spacing.md, paddingTop: spacing.md }}>
          <Button title={t('onboarding.create')} onPress={() => router.push('/(auth)/sign-up')} />
          <Button
            title={t('onboarding.signIn')}
            variant="secondary"
            onPress={() => router.push('/(auth)/sign-in')}
          />
          <View>
            <ListRow
              icon="receipt-long"
              title={t('history.activity')}
              onPress={() => router.push('/history')}
            />
            <ListRow
              icon="language"
              title={`${t('app.language')}: ${locale === 'es' ? t('app.spanish') : t('app.english')}`}
              onPress={() => setLocale(locale === 'es' ? 'en' : 'es')}
            />
            {legal ? (
              <ListRow
                icon="gavel"
                title={t('account.legalTitle')}
                onPress={() => void WebBrowser.openBrowserAsync(legal.termsUrl)}
              />
            ) : null}
          </View>
          <Note>
            {t('app.version')} {auth.config?.version ?? ''}
          </Note>
        </View>
      </Screen>
    );
  }

  return (
    <Screen dense padded={false}>
      {header}
      <View style={{ paddingHorizontal: spacing.list, gap: spacing.md }}>
        {profile &&
        (!profile.emailVerified || !profile.phoneVerified || profile.billingStatus !== 'OK') ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {!profile.emailVerified ? (
              <Badge tone="warning" icon="email" text={t('account.emailUnverified')} />
            ) : null}
            {!profile.phoneVerified ? (
              <Badge tone="warning" icon="phone-android" text={t('account.phoneUnverified')} />
            ) : null}
            {profile.billingStatus !== 'OK' ? (
              <Badge tone="danger" icon="error" text={t('account.blocked')} />
            ) : null}
          </View>
        ) : null}
        {profile && !profile.emailVerified && auth.config?.auth.provider === 'identity-platform' ? (
          <Button
            title={t('verify.title')}
            variant="secondary"
            onPress={() => router.push('/verify-email')}
          />
        ) : null}
        {profile && !profile.phoneVerified && auth.config?.phone.provider !== 'none' ? (
          <Button
            title={t('phone.title')}
            variant="secondary"
            onPress={() => router.push('/verify-phone')}
          />
        ) : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.ms }}>
          <QuickAccess
            icon="receipt-long"
            tone="info"
            label={t('history.activity')}
            onPress={() => router.push('/history')}
          />
          <QuickAccess
            icon="credit-card"
            tone="neutral"
            label={t('account.payment')}
            onPress={() => router.push('/payment-methods')}
          />
          <QuickAccess
            icon="payments"
            tone="danger"
            label={t('account.debts')}
            badge={openDebts || undefined}
            onPress={() => router.push('/debts')}
          />
          <QuickAccess
            icon="notifications"
            tone="success"
            label={t('account.notifications')}
            badge={unread.data?.unread || undefined}
            onPress={() => router.push('/notifications')}
          />
        </View>
        <View>
          <ListRow
            icon="person"
            title={t('account.profile')}
            onPress={() => router.push('/profile')}
          />
          <ListRow
            icon="lock"
            title={t('password.title')}
            onPress={() => router.push('/change-password')}
          />
          <ListRow
            icon="language"
            title={t('app.language')}
            subtitle={locale === 'es' ? t('app.spanish') : t('app.english')}
            onPress={() => setLocale(locale === 'es' ? 'en' : 'es')}
          />
          {pushSupported() ? (
            <ListRow
              icon="notifications-active"
              title={t('notifications.enable')}
              onPress={() => void enablePush()}
            />
          ) : null}
          {support ? (
            <ListRow
              icon="support-agent"
              title={t('account.help')}
              subtitle={support}
              onPress={() => void Linking.openURL(`mailto:${support}`).catch(() => undefined)}
            />
          ) : null}
          {legal ? (
            <ListRow
              icon="description"
              title={t('account.terms')}
              onPress={() => void WebBrowser.openBrowserAsync(legal.termsUrl)}
            />
          ) : null}
          {legal ? (
            <ListRow
              icon="gavel"
              title={t('account.privacy')}
              onPress={() => void WebBrowser.openBrowserAsync(legal.privacyUrl)}
            />
          ) : null}
          <ListRow
            icon="logout"
            title={t('auth.signOut')}
            destructive
            onPress={() => void signOut()}
          />
        </View>
        <Muted>{t('account.deleteHelp')}</Muted>
        <Button title={t('account.delete')} variant="ghost" onPress={() => void remove()} />
        <Note>
          {t('app.version')} {auth.config?.version ?? ''}
        </Note>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 210,
    paddingHorizontal: spacing.list,
    paddingBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.title, fontSize: 24, color: colors.text },
  name: { ...text.titulo2, color: colors.text },
  email: { ...text.cuerpoS, color: colors.text, opacity: 0.85 },
  quick: {
    flexBasis: '46%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.ms,
    gap: spacing.ms,
    minHeight: 112,
    borderWidth: 1,
    borderColor: colors.line,
  },
  quickIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBadgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.onPrimary },
  quickLabel: { ...text.cuerpoS, color: colors.text },
});
