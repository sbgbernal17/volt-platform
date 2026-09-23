/** Entrada: correo y contraseña en Identity Platform; en laboratorio, identidad de desarrollo. */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../src/auth/auth.tsx';
import { authErrorKey } from '../../src/auth/firebase.ts';
import { BrandHeader } from '../../src/components/brand-header.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { spacing } from '../../src/theme/tokens.ts';
import {
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  Heading,
  LinkText,
  Muted,
  Notice,
  Row,
  Screen,
  Title,
} from '../../src/theme/ui.tsx';

export default function SignIn() {
  const { t, locale, setLocale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = auth.config?.auth.provider ?? 'none';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(email, password);
    } catch (caught) {
      setError(t(authErrorKey(caught)));
    } finally {
      setBusy(false);
    }
  };
  const submitDev = async () => {
    if (!/^[0-9a-f-]{36}$/i.test(driverId.trim())) {
      setError(t('auth.error.invalid'));
      return;
    }
    await auth.signInDev(driverId);
  };

  return (
    <Screen padded={false}>
      <BrandHeader>
        <Title>{t('auth.welcome')}</Title>
        <Body>{t('auth.tagline')}</Body>
      </BrandHeader>
      <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
        {auth.configError ? (
          <ErrorBox
            message={t('app.offline')}
            onRetry={() => void auth.reloadConfig()}
            retryLabel={t('app.retry')}
          />
        ) : null}
        {provider === 'identity-platform' ? (
          <>
            <Field
              label={t('auth.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Field
              label={t('auth.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              onSubmitEditing={() => void submit()}
            />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button
              title={t('auth.signIn')}
              onPress={() => void submit()}
              loading={busy}
              disabled={!email || !password}
            />
            <Row between>
              <LinkText onPress={() => router.push('/(auth)/forgot')}>{t('auth.forgot')}</LinkText>
              <LinkText onPress={() => router.push('/(auth)/sign-up')}>{t('auth.signUp')}</LinkText>
            </Row>
          </>
        ) : provider === 'none' && !auth.configError ? (
          <Notice tone="warning">{t('auth.unavailable')}</Notice>
        ) : null}
        {auth.config?.auth.devLogin ? (
          <Card>
            <Heading>{t('auth.devTitle')}</Heading>
            <Muted>{t('auth.devHelp')}</Muted>
            <Field
              label={t('auth.devDriverId')}
              value={driverId}
              onChangeText={setDriverId}
              autoCapitalize="none"
            />
            {error && provider !== 'identity-platform' ? (
              <Notice tone="danger">{error}</Notice>
            ) : null}
            <Button
              title={t('auth.devEnter')}
              variant="secondary"
              onPress={() => void submitDev()}
              disabled={!driverId}
            />
          </Card>
        ) : null}
        <Row between>
          <Muted>{t('app.language')}</Muted>
          <LinkText onPress={() => setLocale(locale === 'es' ? 'en' : 'es')}>
            {locale === 'es' ? t('app.english') : t('app.spanish')}
          </LinkText>
        </Row>
      </View>
    </Screen>
  );
}
