/** Registro (handoff, pantalla 13): nombres, apellidos, correo y contraseña; los consentimientos se aceptan después (ADR 0022). */
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../../src/auth/auth.tsx';
import { authErrorKey } from '../../src/auth/firebase.ts';
import { useI18n } from '../../src/i18n/index.tsx';
import { colors, spacing, text } from '../../src/theme/tokens.ts';
import {
  Button,
  Field,
  LinkText,
  Muted,
  Notice,
  Row,
  Screen,
  Title,
  TopBar,
} from '../../src/theme/ui.tsx';

export default function SignUp() {
  const { t } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const legal = auth.config?.legal;

  const submit = async () => {
    if (password.length < 8) {
      setError(t('auth.error.weak'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.signUp(email, password, { firstName, lastName });
      router.replace('/verify-email');
    } catch (caught) {
      setError(t(authErrorKey(caught)));
    } finally {
      setBusy(false);
    }
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(auth)'));

  return (
    <Screen padded={false}>
      <TopBar onBack={back} backLabel={t('app.back')} />
      <View style={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          <Title>{t('auth.signUpTitle')}</Title>
          <Muted style={{ fontSize: 16, lineHeight: 24 }}>{t('auth.signUpHelp')}</Muted>
        </View>
        <Field
          label={t('auth.firstName')}
          value={firstName}
          onChangeText={setFirstName}
          autoComplete="given-name"
          textContentType="givenName"
        />
        <Field
          label={t('auth.lastName')}
          value={lastName}
          onChangeText={setLastName}
          autoComplete="family-name"
          textContentType="familyName"
        />
        <Field
          label={t('auth.emailLabel')}
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
          autoComplete="new-password"
          textContentType="newPassword"
          help={t('auth.passwordHelp')}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Text style={{ ...text.cuerpoS, color: colors.textSecondary }}>
          {t('auth.terms')}{' '}
          {legal ? (
            <>
              <Text
                style={{ color: colors.link }}
                onPress={() => void WebBrowser.openBrowserAsync(legal.termsUrl)}
              >
                {t('account.terms')}
              </Text>
              {' · '}
              <Text
                style={{ color: colors.link }}
                onPress={() => void WebBrowser.openBrowserAsync(legal.privacyUrl)}
              >
                {t('account.privacy')}
              </Text>
            </>
          ) : null}
        </Text>
        <Button
          title={t('auth.signUp')}
          onPress={() => void submit()}
          loading={busy}
          disabled={!email || !password || !firstName.trim() || !lastName.trim()}
        />
        <Row style={{ justifyContent: 'center' }}>
          <Muted>{t('auth.haveAccount')}</Muted>
          <LinkText onPress={() => router.replace('/(auth)/sign-in')}>
            {t('auth.haveAccountLink')}
          </LinkText>
        </Row>
      </View>
    </Screen>
  );
}
