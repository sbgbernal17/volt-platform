/** Cobros pendientes: enlace de pago de Wompi (se abre en el navegador seguro del sistema). */
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { errorMessage } from '../src/api/client.ts';
import { useQuery } from '../src/api/hooks.ts';
import type { Billing } from '../src/api/types.ts';
import { useAuth } from '../src/auth/auth.tsx';
import { useI18n } from '../src/i18n/index.tsx';
import { formatDateTime, formatMoney } from '../src/lib/format.ts';
import {
  Badge,
  Body,
  Button,
  Card,
  Empty,
  ErrorBox,
  Loading,
  Muted,
  Notice,
  Row,
  Screen,
} from '../src/theme/ui.tsx';

export default function Debts() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const billing = useQuery(() => auth.api.get<Billing>('/billing'), [], { intervalMs: 15_000 });
  const debts = billing.data?.debts ?? [];
  const open = debts.filter((d) => d.status === 'OPEN');

  const pay = async (debtId: string, existing: string | null) => {
    setBusy(debtId);
    setError(null);
    try {
      const url =
        existing ?? (await auth.api.post<{ url: string | null }>(`/debts/${debtId}/pay-link`)).url;
      if (url) await WebBrowser.openBrowserAsync(url);
      await billing.reload();
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
      {open.length ? (
        <Body>{t('debt.intro')}</Body>
      ) : !billing.error ? (
        <Empty text={t('debt.empty')} />
      ) : null}
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
    </Screen>
  );
}
