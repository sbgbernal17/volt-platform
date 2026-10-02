/**
 * Configuración (petición del dueño del 02-10-2026): idioma, tema y avisos push. El permiso de
 * notificaciones se pide solo al entrar a la cuenta (raíz de la app); aquí se ve si quedó activado,
 * se activa si el sistema aún no lo preguntó y, si se negó, se abre el ajuste del sistema.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useAuth } from '../src/auth/auth.tsx';
import { useI18n } from '../src/i18n/index.tsx';
import {
  type PushPermission,
  pushPermissionStatus,
  registerForPush,
} from '../src/lib/notifications.ts';
import { spacing } from '../src/theme/tokens.ts';
import {
  Button,
  Chip,
  Divider,
  ListRow,
  Muted,
  Notice,
  Row,
  Screen,
  Subtitle,
} from '../src/theme/ui.tsx';

export default function SettingsScreen() {
  const { t, locale, setLocale } = useI18n();
  const auth = useAuth();
  const [push, setPush] = useState<PushPermission | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(
    null,
  );
  const refresh = useCallback(() => {
    void pushPermissionStatus().then(setPush);
  }, []);
  useFocusEffect(refresh);

  const enable = async () => {
    const result = await registerForPush(auth.api, locale);
    if (result.ok) setMessage({ tone: 'success', text: t('notifications.enabled') });
    else if (result.reason === 'denied')
      setMessage({ tone: 'warning', text: t('notifications.permission') });
    else setMessage({ tone: 'warning', text: t('notifications.notSupported') });
    refresh();
  };
  const pushText =
    push === 'granted'
      ? t('settings.pushGranted')
      : push === 'denied'
        ? t('settings.pushDenied')
        : push === 'undetermined'
          ? t('settings.pushUndetermined')
          : t('settings.pushUnsupported');

  return (
    <Screen>
      <View style={{ gap: spacing.sm }}>
        <Subtitle>{t('app.language')}</Subtitle>
        <Row>
          <Chip label="Español" active={locale === 'es'} onPress={() => setLocale('es')} />
          <Chip label="English" active={locale === 'en'} onPress={() => setLocale('en')} />
        </Row>
      </View>
      <Divider />
      <View style={{ gap: spacing.sm }}>
        <Subtitle>{t('settings.theme')}</Subtitle>
        <Row>
          <Chip label={t('settings.themeDark')} active icon="dark-mode" />
          <Chip label={t('settings.themeLight')} icon="light-mode" />
        </Row>
        <Muted>{t('settings.themeSoon')}</Muted>
      </View>
      <Divider />
      <View style={{ gap: spacing.sm }}>
        <Subtitle>{t('settings.notifications')}</Subtitle>
        <ListRow
          icon={push === 'granted' ? 'notifications-active' : 'notifications-off'}
          iconTone={push === 'granted' ? 'success' : push === 'unsupported' ? 'neutral' : 'warning'}
          title={pushText}
          subtitle={t('settings.pushHelp')}
        />
        {push === 'undetermined' ? (
          <Button
            title={t('notifications.enable')}
            icon="notifications"
            onPress={() => void enable()}
          />
        ) : null}
        {push === 'denied' && Platform.OS !== 'web' ? (
          <Button
            title={t('settings.openSettings')}
            variant="secondary"
            icon="settings"
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
      </View>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </Screen>
  );
}
