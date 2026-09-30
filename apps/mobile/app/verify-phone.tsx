/**
 * Celular verificado (ADR 0031): la app pide el número, envía un código por SMS y lo confirma. Es
 * obligatorio antes de pagar o cargar (después del correo y los consentimientos) y también sirve para
 * cambiar el número desde la cuenta. Con el emulador de SMS el código llega en la respuesta.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorMessage } from '../src/api/client.ts';
import type { PhoneCodeSent, Profile } from '../src/api/types.ts';
import { useAuth } from '../src/auth/auth.tsx';
import { useI18n } from '../src/i18n/index.tsx';
import { formatPhone, groupPhoneInput, normalizePhoneInput } from '../src/lib/phone.ts';
import { spacing } from '../src/theme/tokens.ts';
import {
  Body,
  Button,
  Field,
  LinkText,
  Muted,
  Notice,
  Row,
  Screen,
  Title,
} from '../src/theme/ui.tsx';

type Step = 'number' | 'code';

export default function VerifyPhone() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const profile = auth.profile;
  const [step, setStep] = useState<Step>('number');
  const [input, setInput] = useState(() =>
    profile?.phone && !profile.phoneVerified ? formatPhone(profile.phone) : '',
  );
  const [sent, setSent] = useState<PhoneCodeSent | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const unavailable = auth.config?.phone.provider === 'none';
  const gate = profile ? !profile.phoneVerified && auth.config?.phone.required : false;

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const describeError = (caught: unknown): string => {
    if (!(caught instanceof ApiError)) return errorMessage(caught, t('app.offline'));
    const details = (caught.details ?? {}) as { retryAfterS?: number; attemptsLeft?: number };
    switch (caught.code) {
      case 'PHONE_INVALID':
        return t('phone.error.PHONE_INVALID');
      case 'PHONE_IN_USE':
        return t('phone.error.PHONE_IN_USE');
      case 'SMS_TOO_SOON':
        setWait(details.retryAfterS ?? 60);
        return t('phone.error.SMS_TOO_SOON', { seconds: String(details.retryAfterS ?? 60) });
      case 'SMS_LIMIT':
        return t('phone.error.SMS_LIMIT');
      case 'SMS_UNAVAILABLE':
        return t('phone.error.SMS_UNAVAILABLE');
      case 'CODE_INVALID':
        return t('phone.error.CODE_INVALID', { left: String(details.attemptsLeft ?? 0) });
      case 'CODE_EXPIRED':
        return t('phone.error.CODE_EXPIRED');
      case 'CODE_ATTEMPTS':
        return t('phone.error.CODE_ATTEMPTS');
      default:
        return errorMessage(caught, t('app.error'));
    }
  };

  const send = async () => {
    const phone = normalizePhoneInput(input);
    if (!phone) {
      setError(t('phone.error.PHONE_INVALID'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await auth.api.post<PhoneCodeSent>('/me/phone/send-code', { phone, locale });
      setSent(result);
      setWait(result.resendAfterS);
      setCode('');
      setStep('code');
      setNotice(t('phone.sent', { phone: formatPhone(result.phone) }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      setError(t('phone.error.CODE_FORMAT'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.api.post<Profile>('/me/phone/verify', { code: code.replace(/\s/g, '') });
      await auth.refreshProfile();
      if (router.canGoBack() && !gate) router.back();
      else router.replace('/');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{step === 'number' ? t('phone.title') : t('phone.codeTitle')}</Title>
      {step === 'number' ? (
        <>
          <Body>{gate ? t('phone.bodyRequired') : t('phone.body')}</Body>
          {profile?.phoneVerified && profile.phone ? (
            <Muted>{t('phone.current', { phone: formatPhone(profile.phone) })}</Muted>
          ) : null}
          <Field
            label={t('account.phone')}
            value={input}
            onChangeText={(value) => {
              setInput(groupPhoneInput(value));
              setError(null);
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            placeholder="300 123 4567"
            prefix={input.trim().startsWith('+') ? undefined : '+57'}
            help={t('phone.help')}
            error={error}
          />
          {unavailable ? <Notice tone="warning">{t('phone.error.SMS_UNAVAILABLE')}</Notice> : null}
          <Button
            title={t('phone.send')}
            onPress={() => void send()}
            loading={busy}
            disabled={!input.trim() || unavailable}
          />
        </>
      ) : (
        <>
          <Body>{t('phone.codeBody', { phone: formatPhone(sent?.phone ?? '') })}</Body>
          {sent?.devCode ? (
            <Notice tone="info">{t('phone.devCode', { code: sent.devCode })}</Notice>
          ) : null}
          <Field
            label={t('phone.codeLabel')}
            value={code}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            placeholder="123456"
            error={error}
          />
          {notice ? <Notice tone="success">{notice}</Notice> : null}
          <Button
            title={t('phone.verify')}
            onPress={() => void verify()}
            loading={busy}
            disabled={code.length < 6}
          />
          <Row style={{ justifyContent: 'space-between' }}>
            <LinkText
              onPress={() => {
                setStep('number');
                setError(null);
                setNotice(null);
              }}
            >
              {t('phone.change')}
            </LinkText>
            {wait > 0 ? (
              <Muted>{t('phone.resendIn', { seconds: String(wait) })}</Muted>
            ) : (
              <LinkText onPress={() => void send()}>{t('phone.resend')}</LinkText>
            )}
          </Row>
        </>
      )}
      {gate ? (
        <View style={{ marginTop: spacing.md }}>
          <Button title={t('auth.signOut')} variant="ghost" onPress={() => void auth.signOut()} />
        </View>
      ) : null}
    </Screen>
  );
}
