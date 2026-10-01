/** Medios de pago (handoff, pantalla 16): filas con franquicia, últimos dígitos y vencimiento; predeterminada; alta y baja. */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { ApiError, errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { PaymentMethod } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { colors, fonts, radius, spacing, type Tone } from '../../src/theme/tokens.ts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
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
      setError(
        caught instanceof ApiError && caught.code === 'PAYMENT_METHOD_IN_USE'
          ? t('payment.removeLocked')
          : errorMessage(caught, t('app.offline')),
      );
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
    <Screen dense>
      {methods.error && !methods.data ? (
        <ErrorBox
          message={errorMessage(methods.error, t('app.offline'))}
          onRetry={() => void methods.reload()}
          retryLabel={t('app.retry')}
        />
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {items.length === 0 && !methods.error ? (
        <EmptyState icon="credit-card" title={t('payment.empty')} />
      ) : null}
      {items.map((method) => (
        <Card
          key={method.id}
          onPress={
            method.sourceStatus === 'PENDING'
              ? () => router.push(`/payment-methods/${method.id}`)
              : undefined
          }
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.ms }}>
            <View style={styles.brand}>
              <Text style={styles.brandText} numberOfLines={1}>
                {method.kind === 'WALLET'
                  ? 'Nequi'
                  : (method.brand ?? t('payment.cardKind')).toUpperCase().slice(0, 6)}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.label}>{methodLabel(method)}</Text>
              <Muted>
                {method.kind === 'WALLET' ? t('payment.walletKind') : t('payment.cardKind')}
                {method.expiresMonth && method.expiresYear
                  ? ` · ${t('payment.expires', { month: String(method.expiresMonth).padStart(2, '0'), year: String(method.expiresYear).slice(-2) })}`
                  : ''}
              </Muted>
            </View>
            {method.isDefault ? (
              <Badge tone="success" icon="check" text={t('payment.default')} />
            ) : (
              <Badge
                tone={sourceTone(method.sourceStatus)}
                text={td(`payment.status.${method.sourceStatus}`)}
              />
            )}
          </View>
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
      <Button
        title={t('payment.addCard')}
        variant={items.length ? 'secondary' : 'primary'}
        icon="add"
        onPress={() => router.push('/payment-methods/new')}
      />
      <Notice tone="neutral" icon="lock">
        {t('payment.lockNote')}
      </Notice>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: {
    width: 48,
    height: 32,
    borderRadius: radius.control,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.text },
  label: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 22, color: colors.text },
});
