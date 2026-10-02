/**
 * Medios de pago (handoff, pantalla 16; revisión del 02-10-2026): tarjetas con la franquicia en
 * color, últimos dígitos y vencimiento, principal, alta y baja, y el sello de Wompi. Con
 * `?select=1` (desde la pantalla del cargador) tocar una tarjeta lista la deja como principal y
 * vuelve al cargador; `returnTo` acompaña al alta para volver al mismo sitio.
 */
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { ApiError, errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { PaymentMethod } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { WompiMark } from '../../src/components/wompi-mark.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { Icon } from '../../src/theme/icon.tsx';
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

/** Colores de la franquicia para el recuadro de la tarjeta (marca reconocible de un vistazo). */
const BRAND_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  VISA: { bg: '#1A1F71', fg: '#FFFFFF', label: 'VISA' },
  MASTERCARD: { bg: '#EB001B', fg: '#FFFFFF', label: 'MC' },
  AMEX: { bg: '#2E77BC', fg: '#FFFFFF', label: 'AMEX' },
  DINERS: { bg: '#0079BE', fg: '#FFFFFF', label: 'DC' },
  NEQUI: { bg: '#E6007E', fg: '#FFFFFF', label: 'Nequi' },
};

export function brandStyle(method: PaymentMethod): { bg: string; fg: string; label: string } {
  const key = method.kind === 'WALLET' ? 'NEQUI' : (method.brand ?? '').toUpperCase();
  return (
    BRAND_STYLES[key] ?? {
      bg: colors.bg,
      fg: colors.text,
      label: (method.brand ?? 'CARD').toUpperCase().slice(0, 6),
    }
  );
}

export default function PaymentMethods() {
  const { t, td } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const { select, returnTo } = useLocalSearchParams<{ select?: string; returnTo?: string }>();
  const selecting = select === '1';
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
      return true;
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'PAYMENT_METHOD_IN_USE'
          ? t('payment.removeLocked')
          : errorMessage(caught, t('app.offline')),
      );
      return false;
    }
  };
  const makeDefault = (method: PaymentMethod) =>
    act(() => auth.api.post(`/payment-methods/${method.id}/default`));
  /** En modo selección: la tarjeta queda como principal y se vuelve al cargador. */
  const choose = async (method: PaymentMethod) => {
    if (method.sourceStatus === 'PENDING') {
      router.push({
        pathname: '/payment-methods/[id]',
        params: { id: method.id, ...(returnTo ? { returnTo } : {}) },
      });
      return;
    }
    if (method.sourceStatus !== 'AVAILABLE') return;
    if (!method.isDefault && !(await makeDefault(method))) return;
    if (selecting) {
      if (router.canGoBack()) router.back();
      else if (returnTo) router.replace(returnTo as Href);
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
  const add = () =>
    router.push({
      pathname: '/payment-methods/new',
      params: returnTo ? { returnTo } : {},
    });

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
      {selecting && items.length ? (
        <Notice tone="info" icon="credit-card">
          {t('payment.selectHelp')}
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {items.length === 0 && !methods.error ? (
        <EmptyState icon="credit-card" title={t('payment.empty')} />
      ) : null}
      {items.map((method) => {
        const brand = brandStyle(method);
        const selectable = method.sourceStatus === 'AVAILABLE' || method.sourceStatus === 'PENDING';
        return (
          <Card
            key={method.id}
            onPress={selectable ? () => void choose(method) : undefined}
            selected={method.isDefault}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.ms }}>
              <View style={[styles.brand, { backgroundColor: brand.bg }]}>
                <Text style={[styles.brandText, { color: brand.fg }]} numberOfLines={1}>
                  {brand.label}
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
              ) : method.sourceStatus !== 'AVAILABLE' ? (
                <Badge
                  tone={sourceTone(method.sourceStatus)}
                  text={td(`payment.status.${method.sourceStatus}`)}
                />
              ) : selecting ? (
                <Icon name="chevron-right" size={24} color={colors.handle} />
              ) : null}
            </View>
            {selecting ? (
              !method.isDefault && method.sourceStatus === 'AVAILABLE' ? (
                <Muted>{t('payment.tapToSelect')}</Muted>
              ) : null
            ) : (
              <Row between>
                {!method.isDefault && method.sourceStatus === 'AVAILABLE' ? (
                  <LinkText onPress={() => void makeDefault(method)}>
                    {t('payment.makeDefault')}
                  </LinkText>
                ) : (
                  <Muted> </Muted>
                )}
                <LinkText onPress={() => remove(method)}>{t('payment.remove')}</LinkText>
              </Row>
            )}
          </Card>
        );
      })}
      <Button
        title={t('payment.addCard')}
        variant={items.length ? 'secondary' : 'primary'}
        icon="add"
        onPress={add}
      />
      <WompiMark />
      <Notice tone="neutral" icon="lock">
        {t('payment.lockNote')}
      </Notice>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: {
    width: 56,
    height: 36,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  brandText: { fontFamily: fonts.titleHeavy, fontSize: 13, letterSpacing: 0.5 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 22, color: colors.text },
});
