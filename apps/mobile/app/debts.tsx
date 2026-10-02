/**
 * Transacciones: cobros pendientes con dos formas de pagar (02-10-2026): cobrar a la tarjeta guardada
 * (POST /v1/debts/:id/retry, sin salir de la app) o pagar con otro medio por el enlace de Wompi (en
 * dev, el checkout emulado de la API); y el historial de movimientos del conductor (cobros, pagos,
 * devoluciones). Si no hay tarjeta lista, se ofrece agregarla y volver aquí.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '../src/api/client.ts';
import { useQuery } from '../src/api/hooks.ts';
import type { Billing, PaymentItem, PaymentMethod } from '../src/api/types.ts';
import { useAuth } from '../src/auth/auth.tsx';
import { useI18n } from '../src/i18n/index.tsx';
import { formatDateTime, formatMoney } from '../src/lib/format.ts';
import { spacing, type Tone } from '../src/theme/tokens.ts';
import {
  Badge,
  Body,
  Button,
  Card,
  Divider,
  Empty,
  ErrorBox,
  Loading,
  Muted,
  Notice,
  Row,
  Screen,
  Subtitle,
} from '../src/theme/ui.tsx';
import { methodLabel } from './payment-methods/index.tsx';

const STATE_TONE: Record<PaymentItem['status'], Tone> = {
  SUCCEEDED: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

interface RetryResult {
  status: 'charged' | 'pending' | 'failed' | 'skipped';
  reason: string | null;
  message: string | null;
}

export default function Transactions() {
  const { t, td, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);
  const paymentsConfigured = auth.config?.payments.provider !== 'none';
  const billing = useQuery(() => auth.api.get<Billing>('/billing'), [], { intervalMs: 15_000 });
  const payments = useQuery(
    () => auth.api.get<{ items: PaymentItem[] }>('/payments', { limit: 50 }),
    [],
    { intervalMs: 15_000 },
  );
  const methods = useQuery(() => auth.api.get<{ items: PaymentMethod[] }>('/payment-methods'), [], {
    enabled: paymentsConfigured,
  });
  // Al volver de agregar una tarjeta, la lista de medios de pago se recarga.
  const firstFocus = useRef(true);
  const reloadMethods = methods.reload;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (paymentsConfigured) void reloadMethods();
    }, [paymentsConfigured, reloadMethods]),
  );
  const debts = billing.data?.debts ?? [];
  const open = debts.filter((d) => d.status === 'OPEN');
  const items = payments.data?.items ?? [];
  const available = methods.data?.items.filter((m) => m.sourceStatus === 'AVAILABLE') ?? [];
  const card = available.find((m) => m.isDefault) ?? available[0] ?? null;

  const refresh = () =>
    Promise.all([
      billing.reload(),
      payments.reload(),
      auth.refreshProfile().catch(() => undefined),
    ]);

  /** Cobro inmediato a la tarjeta guardada; el resultado se muestra sin salir de la app. */
  const retry = async (debtId: string) => {
    setBusy(debtId);
    setNotice(null);
    try {
      const result = await auth.api.post<RetryResult>(`/debts/${debtId}/retry`);
      if (result.status === 'charged') setNotice({ tone: 'success', text: t('debt.retryPaid') });
      else if (result.status === 'pending')
        setNotice({ tone: 'info', text: t('debt.retryPending') });
      else if (result.status === 'failed') {
        const reason = result.message ?? result.reason;
        setNotice({
          tone: 'danger',
          text: t('debt.retryFailed', { reason: reason ? ` (${reason})` : '' }),
        });
      }
      await refresh();
    } catch (caught) {
      setNotice({ tone: 'danger', text: errorMessage(caught, t('app.offline')) });
    } finally {
      setBusy(null);
    }
  };

  /** Enlace de pago de Wompi (PSE, Nequi u otra tarjeta) en el navegador seguro. */
  const payLink = async (debtId: string, existing: string | null) => {
    setBusy(debtId);
    setNotice(null);
    try {
      const url =
        existing ?? (await auth.api.post<{ url: string | null }>(`/debts/${debtId}/pay-link`)).url;
      if (url) await WebBrowser.openBrowserAsync(url);
      await refresh();
    } catch (caught) {
      setNotice({ tone: 'danger', text: errorMessage(caught, t('app.offline')) });
    } finally {
      setBusy(null);
    }
  };

  if (billing.loading && !billing.data) return <Loading text={t('app.loading')} />;
  return (
    <Screen>
      {billing.error && !billing.data ? (
        <ErrorBox
          message={errorMessage(billing.error, t('app.offline'))}
          onRetry={() => void billing.reload()}
          retryLabel={t('app.retry')}
        />
      ) : null}
      <Subtitle>{t('debt.pendingSection')}</Subtitle>
      {open.length ? <Body>{t('debt.intro')}</Body> : <Muted>{t('debt.empty')}</Muted>}
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {open.map((debt) => (
        <Card key={debt.id}>
          <Row between>
            <Body>
              {debt.sessionNo ? t('debt.session', { no: debt.sessionNo }) : debt.id.slice(0, 8)}
            </Body>
            <Badge tone="danger" text={formatMoney(debt.amount, debt.currency)} />
          </Row>
          <Muted>
            {t('debt.attempts', { n: debt.attempts })}
            {debt.nextAttemptAt
              ? ` · ${t('debt.nextAttempt', { when: formatDateTime(debt.nextAttemptAt, locale) })}`
              : ''}
          </Muted>
          {paymentsConfigured && debt.sessionId ? (
            card ? (
              <Button
                title={t('debt.payWithCard', { label: methodLabel(card) })}
                icon="credit-card"
                onPress={() => void retry(debt.id)}
                loading={busy === debt.id}
              />
            ) : (
              <Button
                title={t('debt.addCard')}
                icon="add"
                onPress={() =>
                  router.push({ pathname: '/payment-methods/new', params: { returnTo: '/debts' } })
                }
              />
            )
          ) : null}
          <Button
            title={card && debt.sessionId ? t('debt.payOther') : t('debt.pay')}
            variant={card && debt.sessionId ? 'secondary' : 'primary'}
            icon="open-in-new"
            onPress={() => void payLink(debt.id, debt.paymentLink?.url ?? null)}
            loading={busy === debt.id}
          />
          <Muted>{t('debt.payOtherHelp')}</Muted>
        </Card>
      ))}
      {open.length ? <Muted>{t('debt.paid')}</Muted> : null}

      <Divider />
      <Subtitle>{t('debt.historySection')}</Subtitle>
      {payments.loading && !payments.data ? (
        <Loading text={t('app.loading')} />
      ) : items.length === 0 ? (
        <Empty text={t('debt.historyEmpty')} />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {items.map((item) => (
            <Card key={item.id}>
              <Row between>
                <Body>{td(`payment.kind.${item.kind}`)}</Body>
                <Badge
                  tone={STATE_TONE[item.status] ?? 'neutral'}
                  text={td(`payment.state.${item.status}`)}
                />
              </Row>
              <Row between>
                <Muted>
                  {item.sessionNo ? `${t('debt.session', { no: item.sessionNo })} · ` : ''}
                  {formatDateTime(item.finalizedAt ?? item.createdAt, locale)}
                </Muted>
                <Body>{formatMoney(item.amount, item.currency)}</Body>
              </Row>
              {item.methodLabel || item.statusMessage ? (
                <Muted>
                  {[item.methodLabel, item.status === 'FAILED' ? item.statusMessage : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Muted>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
