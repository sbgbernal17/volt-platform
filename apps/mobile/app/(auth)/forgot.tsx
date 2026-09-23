import { useState } from 'react';
import { useAuth } from '../../src/auth/auth.tsx';
import { authErrorKey } from '../../src/auth/firebase.ts';
import { useI18n } from '../../src/i18n/index.tsx';
import { Body, Button, Field, Notice, Screen } from '../../src/theme/ui.tsx';

export default function Forgot() {
  const { t } = useI18n();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.resetPassword(email);
      setSent(true);
    } catch (caught) {
      // Por privacidad no se revela si el correo existe.
      if (authErrorKey(caught) === 'auth.error.invalid') setSent(true);
      else setError(t(authErrorKey(caught)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Body>{t('auth.forgotHelp')}</Body>
      <Field
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {sent ? <Notice tone="success">{t('auth.forgotSent')}</Notice> : null}
      <Button
        title={t('auth.sendLink')}
        onPress={() => void submit()}
        loading={busy}
        disabled={!email || sent}
      />
    </Screen>
  );
}
