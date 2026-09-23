/** Cuenta: perfil, medios de pago, cobros pendientes, avisos, idioma, legal, salida y borrado. */
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { ApiError } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Billing } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { pushSupported, registerForPush, unregisterPush } from '../../src/lib/notifications.ts';
import { colors, spacing } from '../../src/theme/tokens.ts';
import {
  Badge,
  Body,
  Button,
  Card,
  Heading,
  Muted,
  Notice,
  Row,
  Screen,
} from '../../src/theme/ui.tsx';

function confirm(title: string, message: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function Account() {
  const { t, locale, setLocale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [message, setMessage] = useState<{
    tone: 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);
  const billing = useQuery(() => auth.api.get<Billing>('/billing'), [], { intervalMs: 30_000 });
  const unread = useQuery(
    () => auth.api.get<{ unread: number }>('/me/notifications', { limit: 1 }),
    [],
    { intervalMs: 30_000 },
  );
  const profile = auth.profile;
  const openDebts = billing.data?.debts.filter((d) => d.status === 'OPEN').length ?? 0;

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

  const Item = ({
    icon,
    label,
    badge,
    onPress,
  }: {
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    badge?: string | undefined;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <MaterialIcons name={icon} size={24} color={colors.textSecondary} />
      <Body style={{ flex: 1 }}>{label}</Body>
      {badge ? <Badge tone="danger" text={badge} /> : null}
      <MaterialIcons name="chevron-right" size={24} color={colors.textSecondary} />
    </Pressable>
  );

  return (
    <Screen>
      <Card onPress={() => router.push('/profile')}>
        <Heading>{profile?.displayName ?? auth.email ?? t('account.profile')}</Heading>
        <Muted>{profile?.email ?? auth.email ?? ''}</Muted>
        <Row>
          {profile ? (
            <Badge
              tone={profile.emailVerified ? 'success' : 'warning'}
              text={
                profile.emailVerified ? t('account.emailVerified') : t('account.emailUnverified')
              }
            />
          ) : null}
          {profile?.billingStatus !== 'OK' && profile ? (
            <Badge tone="danger" text={t('account.blocked')} />
          ) : null}
        </Row>
      </Card>
      {profile && !profile.emailVerified && auth.config?.auth.provider === 'identity-platform' ? (
        <Button
          title={t('verify.title')}
          variant="secondary"
          onPress={() => router.push('/verify-email')}
        />
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <View>
        <Item
          icon="credit-card"
          label={t('account.payment')}
          onPress={() => router.push('/payment-methods')}
        />
        <Item
          icon="receipt-long"
          label={t('account.debts')}
          badge={openDebts ? String(openDebts) : undefined}
          onPress={() => router.push('/debts')}
        />
        <Item
          icon="notifications"
          label={t('account.notifications')}
          badge={unread.data?.unread ? String(unread.data.unread) : undefined}
          onPress={() => router.push('/notifications')}
        />
        <Item
          icon="language"
          label={`${t('app.language')}: ${locale === 'es' ? t('app.spanish') : t('app.english')}`}
          onPress={() => setLocale(locale === 'es' ? 'en' : 'es')}
        />
        {auth.config ? (
          <Item
            icon="description"
            label={t('account.terms')}
            onPress={() => void WebBrowser.openBrowserAsync(auth.config?.legal.termsUrl ?? '')}
          />
        ) : null}
        {auth.config ? (
          <Item
            icon="privacy-tip"
            label={t('account.privacy')}
            onPress={() => void WebBrowser.openBrowserAsync(auth.config?.legal.privacyUrl ?? '')}
          />
        ) : null}
      </View>
      {pushSupported() ? (
        <Button
          title={t('notifications.enable')}
          variant="secondary"
          onPress={() => void enablePush()}
        />
      ) : null}
      <Button title={t('auth.signOut')} variant="secondary" onPress={() => void signOut()} />
      <Muted>{t('account.deleteHelp')}</Muted>
      <Button title={t('account.delete')} variant="danger" onPress={() => void remove()} />
      <Muted>
        {t('app.version')} {auth.config?.version ?? ''}
        {auth.config?.legal.supportEmail
          ? ` · ${t('app.support')}: ${auth.config.legal.supportEmail}`
          : ''}
      </Muted>
    </Screen>
  );
}
