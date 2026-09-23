/**
 * Alta de un medio de pago: tarjeta (tokenizada directo en Wompi con la llave pública; con el
 * emulador, contra la API) o Nequi (token con el celular y aprobación en la app Nequi). Los tokens
 * de aceptación de Wompi se obtienen de la API y se muestran sus enlaces.
 */

import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ApiError, errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Acceptance, PaymentMethod } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { cardBrand, luhnValid, WompiClient, WompiError } from '../../src/lib/wompi.ts';
import {
  Body,
  Button,
  Field,
  LinkText,
  Loading,
  Muted,
  Notice,
  Row,
  Screen,
} from '../../src/theme/ui.tsx';

function groupCard(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

function splitExpiry(value: string): { month: string; year: string } | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 4) return null;
  const month = digits.slice(0, 2);
  const year = digits.slice(2);
  if (Number(month) < 1 || Number(month) > 12) return null;
  const now = new Date();
  const expires = new Date(2000 + Number(year), Number(month), 0, 23, 59, 59);
  if (expires < now) return null;
  return { month, year };
}

export default function NewPaymentMethod() {
  const { t } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [kind, setKind] = useState<'CARD' | 'NEQUI'>('CARD');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [holder, setHolder] = useState(auth.profile?.displayName ?? '');
  const [phone, setPhone] = useState(auth.profile?.phone?.replace(/\D/g, '').slice(-10) ?? '');
  const [busy, setBusy] = useState(false);
  const [waitingNequi, setWaitingNequi] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const acceptance = useQuery(
    () => auth.api.get<Acceptance>('/payment-methods/acceptance'),
    [],
    {},
  );
  const payments = auth.config?.payments;
  const provider = payments?.provider ?? 'none';
  const wompi =
    provider === 'wompi' && payments?.publicKey && payments.apiBaseUrl
      ? new WompiClient({ apiBaseUrl: payments.apiBaseUrl, publicKey: payments.publicKey })
      : null;

  const register = async (type: 'CARD' | 'NEQUI', token: string) => {
    const tokens = acceptance.data;
    if (!tokens) throw new Error('acceptance');
    const method = await auth.api.post<PaymentMethod>('/payment-methods', {
      type,
      token,
      acceptanceToken: tokens.acceptanceToken,
      personalDataAuthToken: tokens.personalDataAuthToken,
    });
    if (method.sourceStatus === 'PENDING') router.replace(`/payment-methods/${method.id}`);
    else router.replace('/payment-methods');
  };

  const submitCard = async () => {
    const next: Record<string, string> = {};
    const parsedExpiry = splitExpiry(expiry);
    if (!luhnValid(number)) next.number = t('payment.invalidCard');
    if (!parsedExpiry) next.expiry = t('payment.invalidExpiry');
    if (!/^\d{3,4}$/.test(cvc)) next.cvc = t('payment.invalidCvc');
    if (holder.trim().length < 2) next.holder = t('payment.invalidHolder');
    setErrors(next);
    if (Object.keys(next).length || !parsedExpiry) return;
    setBusy(true);
    setError(null);
    try {
      const card = {
        number: number.replace(/\s+/g, ''),
        cvc,
        expMonth: parsedExpiry.month,
        expYear: parsedExpiry.year,
        cardHolder: holder.trim(),
      };
      let token: string;
      if (wompi) token = (await wompi.tokenizeCard(card)).token;
      else token = (await auth.api.post<{ token: string }>('/payment-methods/tokens', card)).token;
      await register('CARD', token);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'EMAIL_NOT_VERIFIED') {
        router.push('/verify-email');
        return;
      }
      setError(
        caught instanceof WompiError ? caught.message : errorMessage(caught, t('app.offline')),
      );
    } finally {
      setBusy(false);
    }
  };

  const submitNequi = async () => {
    if (!/^\d{10}$/.test(phone)) {
      setErrors({ phone: t('payment.invalidPhone') });
      return;
    }
    if (!wompi) {
      setError(t('payment.unavailable'));
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      const pending = await wompi.tokenizeNequi(phone);
      setWaitingNequi(true);
      const result = await wompi.waitForNequi(pending.token);
      setWaitingNequi(false);
      if (result.status !== 'APPROVED') {
        setError(t('payment.nequiDeclined'));
        return;
      }
      await register('NEQUI', result.token);
    } catch (caught) {
      setWaitingNequi(false);
      setError(
        caught instanceof WompiError ? caught.message : errorMessage(caught, t('app.offline')),
      );
    } finally {
      setBusy(false);
    }
  };

  if (provider === 'none') {
    return (
      <Screen>
        <Notice tone="warning">{t('payment.unavailable')}</Notice>
      </Screen>
    );
  }
  if (acceptance.loading && !acceptance.data) return <Loading text={t('app.loading')} />;
  const brand = cardBrand(number);
  return (
    <Screen>
      <Row>
        <Button
          title={t('payment.card')}
          variant={kind === 'CARD' ? 'primary' : 'secondary'}
          style={{ flex: 1, width: undefined }}
          onPress={() => setKind('CARD')}
        />
        {provider === 'wompi' ? (
          <Button
            title={t('payment.nequi')}
            variant={kind === 'NEQUI' ? 'primary' : 'secondary'}
            style={{ flex: 1, width: undefined }}
            onPress={() => setKind('NEQUI')}
          />
        ) : null}
      </Row>
      {kind === 'CARD' ? (
        <>
          <Field
            label={`${t('payment.cardNumber')}${brand ? ` · ${brand}` : ''}`}
            value={number}
            onChangeText={(v) => setNumber(groupCard(v))}
            keyboardType="number-pad"
            autoComplete="cc-number"
            textContentType="creditCardNumber"
            error={errors.number}
          />
          <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <Field
              label={t('payment.expiry')}
              value={expiry}
              onChangeText={(v) =>
                setExpiry(
                  v
                    .replace(/\D/g, '')
                    .slice(0, 4)
                    .replace(/(\d{2})(?=\d)/, '$1/'),
                )
              }
              keyboardType="number-pad"
              autoComplete="cc-exp"
              error={errors.expiry}
              style={{ minWidth: 120 }}
            />
            <Field
              label={t('payment.cvc')}
              value={cvc}
              onChangeText={(v) => setCvc(v.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              secureTextEntry
              autoComplete="cc-csc"
              error={errors.cvc}
              style={{ minWidth: 100 }}
            />
          </Row>
          <Field
            label={t('payment.holder')}
            value={holder}
            onChangeText={setHolder}
            autoCapitalize="characters"
            autoComplete="cc-name"
            error={errors.holder}
          />
          <Muted>{t('payment.secure')}</Muted>
          {payments?.environment !== 'production' ? <Muted>{t('payment.testHint')}</Muted> : null}
        </>
      ) : (
        <>
          <Field
            label={t('payment.phone')}
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
            keyboardType="phone-pad"
            error={errors.phone}
          />
          {waitingNequi ? <Notice tone="info">{t('payment.nequiWait')}</Notice> : null}
        </>
      )}
      {acceptance.data ? (
        <>
          <Body>{t('payment.acceptance')}</Body>
          <LinkText
            onPress={() =>
              void WebBrowser.openBrowserAsync(acceptance.data?.acceptancePermalink ?? '')
            }
          >
            {t('payment.acceptanceLink')}
          </LinkText>
        </>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        title={kind === 'CARD' ? t('payment.saveCard') : t('payment.saveNequi')}
        onPress={() => void (kind === 'CARD' ? submitCard() : submitNequi())}
        loading={busy}
        disabled={!acceptance.data}
      />
    </Screen>
  );
}
