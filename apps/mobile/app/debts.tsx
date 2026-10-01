/**
 * Transacciones: cobros pendientes con "Pagar ahora" (enlace de pago de Wompi o, en dev, el checkout
 * emulado de la API) y el historial de movimientos del conductor (cobros, pagos, devoluciones).
 */
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '../src/api/client.ts';
import { useQuery } from '../src/api/hooks.ts';
import type { Billing, PaymentItem } from '../src/api/types.ts';
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

const STATE_TONE: Record<PaymentItem['status'], Tone> = {
  SUCCEEDED: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

export default function Transactions() {
  const { t, td, locale } = useI18n();
  const auth = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const billing = useQuery(() => auth.api.get<Billing>('/billing'), [], { intervalMs: 15_000 });
  const payments = useQuery(
    () => auth.api.get<{ items: PaymentItem[] }>('/payments', { limit: 50 }),
    [],
    { intervalMs: 15_000 },
  );
  const debts = billing.data?.debts ?? [];
  const open = debts.filter((d) => d.status === 'OPEN');
  const items = payments.data?.items ?? [];

  const pay = async (debtId: string, existing: string | null) => {
    setBusy(debtId);
    setError(null);
    try {
      const url =
        existing ?? (await auth.api.post<{ url: string | null }>(`/debts/${debtId}/pay-link`)).url;
      if (url) await WebBrowser.openBrowserAsync(url);
      await Promise.all([billing.reload(), payments.reload()]);
    } catch (caught) {
      setError(errorMessage(caught, t('app.offline')));
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
      {error ? <Notice tone="danger">{error}</Notice> : null}
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
          <Button
            title={t('debt.pay')}
            onPress={() => void pay(debt.id, debt.paymentLink?.url ?? null)}
            loading={busy === debt.id}
          />
          <Muted>{t('debt.payHelp')}</Muted>
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
