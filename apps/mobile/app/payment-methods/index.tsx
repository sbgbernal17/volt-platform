/** Medios de pago del conductor: lista, principal, eliminación y alta. */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { PaymentMethod } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import type { Tone } from '../../src/theme/tokens.ts';
import {
  Badge,
  Body,
  Button,
  Card,
  Empty,
  ErrorBox,
  LinkText,
  Loading,
  Muted,
  Notice,
  Row,
  Screen,
} from '../../src/theme/ui.tsx';

export function sourceTone(status: string): Tone {
  if (status === 'AVAILABLE') return 'success';
  if (status === 'PENDING') return 'warning';
  return 'danger';
}

export function methodLabel(method: PaymentMethod): string {
  if (method.kind === 'WALLET') return `Nequi${method.last4 ? ` · ${method.last4}` : ''}`;
  return `${method.brand ?? 'Tarjeta'} •••• ${method.last4 ?? ''}`;
}

export default function PaymentMethods() {
  const { t, td } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const methods = useQuery(
    () => auth.api.get<{ items: PaymentMethod[] }>('/payment-methods'),
    [],
    {},
  );
  const configured = auth.config?.payments.provider !== 'none';

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await methods.reload();
    } catch (caught) {
      setError(errorMessage(caught, t('app.offline')));
    }
  };
  const remove = (method: PaymentMethod) => {
    const run = () => void act(() => auth.api.delete(`/payment-methods/${method.id}`));
    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('payment.removeConfirm'))) run();
      return;
    }
    Alert.alert(t('payment.remove'), t('payment.removeConfirm'), [
      { text: t('app.cancel'), style: 'cancel' },
      { text: t('payment.remove'), style: 'destructive', onPress: run },
    ]);
  };

  if (!configured) {
    return (
      <Screen>
        <Notice tone="warning">{t('payment.unavailable')}</Notice>
      </Screen>
    );
  }
  if (methods.loading && !methods.data) return <Loading text={t('app.loading')} />;
  const items = methods.data?.items ?? [];
  return (
    <Screen>
      {methods.error && !methods.data ? (
        <ErrorBox
          message={errorMessage(methods.error, t('app.offline'))}
          onRetry={() => void methods.reload()}
          retryLabel={t('app.retry')}
        />
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {items.length === 0 && !methods.error ? <Empty text={t('payment.empty')} /> : null}
      {items.map((method) => (
        <Card
          key={method.id}
          onPress={
            method.sourceStatus === 'PENDING'
              ? () => router.push(`/payment-methods/${method.id}`)
              : undefined
          }
        >
          <Row between>
            <Body>{methodLabel(method)}</Body>
            <Row>
              {method.isDefault ? <Badge tone="info" text={t('payment.default')} /> : null}
              <Badge
                tone={sourceTone(method.sourceStatus)}
                text={td(`payment.status.${method.sourceStatus}`)}
              />
            </Row>
          </Row>
          {method.expiresMonth && method.expiresYear ? (
            <Muted>
              {t('payment.expires', {
                month: String(method.expiresMonth).padStart(2, '0'),
                year: String(method.expiresYear).slice(-2),
              })}
            </Muted>
          ) : null}
          <Row between>
            {!method.isDefault && method.sourceStatus === 'AVAILABLE' ? (
              <LinkText
                onPress={() =>
                  void act(() => auth.api.post(`/payment-methods/${method.id}/default`))
                }
              >
                {t('payment.makeDefault')}
              </LinkText>
            ) : (
              <Muted> </Muted>
            )}
            <LinkText onPress={() => remove(method)}>{t('payment.remove')}</LinkText>
          </Row>
        </Card>
      ))}
      <Button title={t('payment.add')} onPress={() => router.push('/payment-methods/new')} />
    </Screen>
  );
}
