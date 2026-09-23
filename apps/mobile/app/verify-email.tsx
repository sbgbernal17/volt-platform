/** Verificación del correo: la API exige el correo verificado para pagar y cargar (ADR 0022). */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../src/auth/auth.tsx';
import { useI18n } from '../src/i18n/index.tsx';
import { Body, Button, Notice, Screen, Title } from '../src/theme/ui.tsx';

export default function VerifyEmail() {
  const { t } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(
    null,
  );

  const check = async () => {
    setBusy(true);
    try {
      const verified = await auth.checkVerification();
      if (verified) router.replace('/');
      else setMessage({ tone: 'warning', text: t('verify.notYet') });
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    await auth.resendVerification();
    setMessage({ tone: 'success', text: t('verify.resent') });
  };

  return (
    <Screen>
      <Title>{t('verify.title')}</Title>
      <Body>{t('verify.body', { email: auth.email ?? '' })}</Body>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button title={t('verify.check')} onPress={() => void check()} loading={busy} />
      <Button title={t('verify.resend')} variant="secondary" onPress={() => void resend()} />
      <Button title={t('auth.signOut')} variant="ghost" onPress={() => void auth.signOut()} />
    </Screen>
  );
}
