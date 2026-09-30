/** Cambio de contraseña desde la cuenta: contraseña actual, nueva y confirmación (Identity Platform). */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../src/auth/auth.tsx';
import { authErrorKey } from '../src/auth/firebase.ts';
import { useI18n } from '../src/i18n/index.tsx';
import { Body, Button, Field, Notice, Screen } from '../src/theme/ui.tsx';

export default function ChangePassword() {
  const { t } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const identity = auth.config?.auth.provider === 'identity-platform';

  const submit = async () => {
    setError(null);
    if (next.length < 8) {
      setError(t('auth.error.weak'));
      return;
    }
    if (next !== confirm) {
      setError(t('password.mismatch'));
      return;
    }
    if (next === current) {
      setError(t('password.same'));
      return;
    }
    setBusy(true);
    try {
      await auth.changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (caught) {
      const key = authErrorKey(caught);
      setError(key === 'auth.error.invalid' ? t('password.wrongCurrent') : t(key));
    } finally {
      setBusy(false);
    }
  };

  if (!identity) {
    return (
      <Screen>
        <Notice tone="warning">{t('auth.unavailable')}</Notice>
      </Screen>
    );
  }

  return (
    <Screen>
      <Body>{t('password.help')}</Body>
      <Field
        label={t('password.current')}
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      <Field
        label={t('password.new')}
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        help={t('auth.passwordHelp')}
      />
      <Field
        label={t('password.confirm')}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? <Notice tone="success">{t('password.done')}</Notice> : null}
      <Button
        title={t('password.submit')}
        onPress={() => void submit()}
        loading={busy}
        disabled={!current || !next || !confirm}
      />
      {done ? (
        <Button title={t('app.back')} variant="secondary" onPress={() => router.back()} />
      ) : null}
    </Screen>
  );
}
