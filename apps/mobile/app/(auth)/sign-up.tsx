import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../../src/auth/auth.tsx';
import { authErrorKey } from '../../src/auth/firebase.ts';
import { useI18n } from '../../src/i18n/index.tsx';
import { Button, Field, Muted, Notice, Screen } from '../../src/theme/ui.tsx';

export default function SignUp() {
  const { t } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (password.length < 8) {
      setError(t('auth.error.weak'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.signUp(email, password, name);
      router.replace('/verify-email');
    } catch (caught) {
      setError(t(authErrorKey(caught)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Field
        label={t('auth.name')}
        value={name}
        onChangeText={setName}
        autoComplete="name"
        textContentType="name"
      />
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
        autoComplete="new-password"
        textContentType="newPassword"
        help={t('auth.passwordHelp')}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Muted>{t('auth.terms')}</Muted>
      <Button
        title={t('auth.signUp')}
        onPress={() => void submit()}
        loading={busy}
        disabled={!email || !password}
      />
    </Screen>
  );
}
