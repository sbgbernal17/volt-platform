/**
 * Confirmación del cargador (handoff, pantallas 08 y 21): estación y cargador, potencia y
 * conector, precio desagregado antes de cargar (Resolución 40123), medio de pago que se usará y
 * el botón que inicia la carga con la cotización vista (`quoteId`) y una clave de idempotencia.
 * El invitado ve todo y el botón lo lleva a crear la cuenta; al terminar vuelve aquí.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError, errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type {
  Billing,
  EvseDetail,
  Location,
  PaymentMethod,
  Session,
  SessionStartError,
} from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { ConnectorBadge } from '../../src/components/connector-badge.tsx';
import { StepList } from '../../src/components/step-list.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import {
  formatClock,
  formatKw,
  formatMoney,
  formatPerKwh,
  formatPowerType,
  formatStandard,
} from '../../src/lib/format.ts';
import { randomKey } from '../../src/lib/random.ts';
import { chargerNumber } from '../../src/lib/stations.ts';
import { useActiveSession } from '../../src/session/active-session.tsx';
import { colors, fonts, spacing, text } from '../../src/theme/tokens.ts';
import {
  Body,
  Button,
  Card,
  Divider,
  ErrorBox,
  ListRow,
  Loading,
  Muted,
  Notice,
  Row,
  Screen,
  Subtitle,
  Title,
  TopBar,
} from '../../src/theme/ui.tsx';
import { methodLabel } from '../payment-methods/index.tsx';

function bandLabel(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  const clock = (hhmm: string) => {
    const [h = '0', m = '00'] = hhmm.split(':');
    const hour = Number(h);
    return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${hour < 12 ? 'a. m.' : 'p. m.'}`;
  };
  return `${start ? clock(start) : ''} – ${end ? clock(end) : ''}`;
}

const PAYMENT_CODES = new Set([
  'NO_PAYMENT_METHOD',
  'PAYMENT_METHOD_PENDING',
  'DEBT_PENDING',
  'PAYMENT_DECLINED',
]);

export default function EvseScreen() {
  const { evseId } = useLocalSearchParams<{ evseId: string }>();
  const { t, td, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const activeSession = useActiveSession();
  const signedIn = auth.status === 'authenticated';
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ text: string; code: string | null } | null>(null);
  const idempotencyKey = useMemo(() => randomKey(), []);
  const evse = useQuery(
    () => auth.api.get<EvseDetail>(`/evses/${encodeURIComponent(evseId ?? '')}`),
    [evseId],
    { enabled: Boolean(evseId), intervalMs: 10_000 },
  );
  const locations = useQuery(() => auth.api.get<{ items: Location[] }>('/locations'), [], {});
  const billing = useQuery(() => auth.api.get<Billing>('/billing'), [signedIn], {
    enabled: signedIn,
  });
  const paymentsConfigured = auth.config?.payments.provider !== 'none';
  const methods = useQuery(
    () => auth.api.get<{ items: PaymentMethod[] }>('/payment-methods'),
    [signedIn],
    { enabled: signedIn && paymentsConfigured },
  );
  const data = evse.data;
  const tariff = data?.tariff ?? null;
  const station =
    locations.data?.items.find((item) => item.evses.some((e) => e.evseId === evseId)) ?? null;
  const index = station ? station.evses.findIndex((e) => e.evseId === evseId) : -1;
  const defaultMethod =
    methods.data?.items.find((m) => m.isDefault && m.sourceStatus === 'AVAILABLE') ?? null;
  const canStart = Boolean(
    data && tariff && (data.status === 'Available' || data.status === 'Preparing'),
  );
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  const start = async () => {
    if (!data) return;
    if (!signedIn) {
      auth.setReturnTo(`/evse/${encodeURIComponent(data.evseId)}`);
      router.push('/(auth)/sign-up');
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const session = await auth.api.post<Session>(
        '/sessions',
        { evseId: data.evseId, ...(tariff ? { quoteId: tariff.quoteId } : {}) },
        { 'idempotency-key': idempotencyKey },
      );
      await activeSession.refresh();
      router.replace(`/session/${session.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === 'EMAIL_NOT_VERIFIED') {
          router.push('/verify-email');
          return;
        }
        if (caught.code === 'CONSENT_REQUIRED') {
          await auth.refreshProfile();
          router.replace('/consents');
          return;
        }
        if (caught.code === 'PHONE_NOT_VERIFIED') {
          await auth.refreshProfile();
          router.push('/verify-phone');
          return;
        }
        if (
          caught.status === 409 &&
          caught.body &&
          typeof caught.body === 'object' &&
          'session' in caught.body
        ) {
          const failed = caught.body as SessionStartError;
          const code = failed.session.failureCode ?? failed.error.code;
          const key = `session.failedCode.${code}`;
          setStartError({ text: td(key) === key ? t('session.failedCode.other') : td(key), code });
          return;
        }
        if (caught.code === 'CHARGER_OFFLINE') {
          setStartError({ text: t('session.failedCode.CHARGER_OFFLINE'), code: 'CHARGER_OFFLINE' });
          return;
        }
      }
      setStartError({ text: errorMessage(caught, t('app.offline')), code: null });
    } finally {
      setStarting(false);
    }
  };

  if (evse.loading && !data) return <Loading text={t('app.loading')} />;
  if (evse.error && !data) {
    const notFound = evse.error instanceof ApiError && evse.error.status === 404;
    return (
      <Screen padded={false}>
        <TopBar onBack={back} backLabel={t('app.back')} />
        <View style={{ paddingHorizontal: spacing.list }}>
          <ErrorBox
            message={
              notFound
                ? t('evse.notFound', { id: evseId ?? '' })
                : errorMessage(evse.error, t('app.offline'))
            }
            onRetry={() => void evse.reload()}
            retryLabel={t('app.retry')}
          />
        </View>
      </Screen>
    );
  }
  if (!data) return null;

  const paymentFailed = startError?.code && PAYMENT_CODES.has(startError.code);
  const blockedReason =
    billing.data && !billing.data.canCharge && billing.data.reason
      ? td(`session.failedCode.${billing.data.reason.code}`) ===
        `session.failedCode.${billing.data.reason.code}`
        ? billing.data.reason.message
        : td(`session.failedCode.${billing.data.reason.code}`)
      : null;
  const needsPayment =
    signedIn &&
    paymentsConfigured &&
    ((methods.data && !defaultMethod) || billing.data?.reason?.code === 'NO_PAYMENT_METHOD');

  return (
    <Screen
      dense
      padded={false}
      bottom={
        paymentFailed ? (
          <View style={{ gap: spacing.sm }}>
            <Button
              title={t('evse.useOtherCard')}
              icon="credit-card"
              onPress={() => router.push('/payment-methods/new')}
            />
            <Button title={t('app.cancel')} variant="secondary" onPress={back} />
          </View>
        ) : (
          <Button
            title={signedIn ? t('evse.continue') : t('evse.guestButton')}
            onPress={() => void start()}
            loading={starting}
            disabled={!canStart}
          />
        )
      }
    >
      <TopBar onBack={back} backLabel={t('app.back')} />
      <View style={{ paddingHorizontal: spacing.list, gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          {station ? <Muted>{station.name}</Muted> : null}
          <Title>
            {index >= 0
              ? t('evse.confirmTitle', { number: chargerNumber(index) })
              : t('evse.connectorTitle', { connectorId: data.connectorId ?? '—' })}
          </Title>
          <Muted>{data.evseId}</Muted>
        </View>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ gap: 2 }}>
              <Muted>{t('evse.power')}</Muted>
              <Text style={styles.fact}>
                {data.chargerMaxPowerKw
                  ? t('power.upTo', { power: formatKw(data.chargerMaxPowerKw) })
                  : formatKw(data.maxPowerKw)}
              </Text>
              <Muted>
                {formatPowerType(data.powerType, locale)}
                {data.powerShared ? ` · ${t('power.sharedShort')}` : ''}
              </Muted>
            </View>
            <View style={styles.vDivider} />
            <View style={{ gap: 2, flex: 1 }}>
              <Muted>{t('evse.connector')}</Muted>
              <Text style={styles.fact}>{formatStandard(data.standard, locale)}</Text>
            </View>
            <ConnectorBadge status={data.status} />
          </View>
        </Card>

        {paymentFailed ? (
          <Card>
            <Subtitle>{t('evse.failedTitle')}</Subtitle>
            <StepList
              steps={[
                { label: t('evse.stepCharger'), state: 'done' },
                { label: t('evse.stepPayment'), state: 'error', detail: startError?.text },
                { label: t('evse.stepStart'), state: 'pending' },
              ]}
            />
            <Notice tone="danger" icon="credit-card-off">
              {t('evse.noCharge')}
            </Notice>
          </Card>
        ) : startError ? (
          <Notice tone="danger">{startError.text}</Notice>
        ) : null}

        <Card>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <Subtitle>{t('station.tariff')}</Subtitle>
            {tariff ? (
              <Text style={styles.price}>
                {formatPerKwh(tariff.energy.pricePerKwhNow, tariff.currency)}
              </Text>
            ) : null}
          </View>
          {tariff ? (
            <>
              {tariff.energy.elements.length > 1 ? (
                <View style={{ gap: spacing.xs }}>
                  <Muted>{t('evse.timeBands')}</Muted>
                  {tariff.energy.elements.map((element) => (
                    <Row
                      key={`${element.startTime}-${element.endTime}-${element.pricePerKwh}`}
                      between
                    >
                      <Body>
                        {element.startTime || element.endTime
                          ? bandLabel(element.startTime, element.endTime)
                          : t('evse.bandOther')}
                      </Body>
                      <Body>{formatPerKwh(element.pricePerKwh, tariff.currency)}</Body>
                    </Row>
                  ))}
                </View>
              ) : null}
              <Divider />
              <Body>
                {tariff.idleFee
                  ? t('evse.idleText', {
                      grace: tariff.idleFee.gracePeriodMin,
                      price: formatMoney(tariff.idleFee.pricePerMinute, tariff.currency),
                    })
                  : t('evse.idleNone')}
              </Body>
              {tariff.sessionFee ? (
                <Row between>
                  <Muted>{t('evse.sessionFee')}</Muted>
                  <Body>{formatMoney(tariff.sessionFee, tariff.currency)}</Body>
                </Row>
              ) : null}
              {tariff.minPrice ? (
                <Row between>
                  <Muted>{t('evse.minPrice')}</Muted>
                  <Body>{formatMoney(tariff.minPrice, tariff.currency)}</Body>
                </Row>
              ) : null}
              {tariff.exposureLimit ? (
                <Muted>
                  {t('evse.limitText', {
                    limit: formatMoney(tariff.exposureLimit, tariff.currency),
                  })}
                </Muted>
              ) : null}
              <Muted>
                {t('evse.tariffExcluded')}{' '}
                {t('evse.quoteValid', { time: formatClock(tariff.validUntil) })}
              </Muted>
            </>
          ) : (
            <Notice tone="warning">{t('evse.noTariff')}</Notice>
          )}
        </Card>

        {blockedReason ? <Notice tone="warning">{blockedReason}</Notice> : null}
        {data.status !== 'Available' && data.status !== 'Preparing' ? (
          <Notice tone="info">
            {data.status === 'Unavailable' || data.status === 'Faulted'
              ? t('evse.unavailable', { id: data.evseId })
              : t('evse.busy')}
          </Notice>
        ) : null}

        <View>
          {!signedIn ? (
            <ListRow
              icon="person"
              iconTone="info"
              title={t('evse.guestRow')}
              onPress={() => void start()}
            />
          ) : !paymentsConfigured ? null : defaultMethod ? (
            <ListRow
              icon="credit-card"
              iconTone="info"
              title={methodLabel(defaultMethod)}
              subtitle={t('evse.paymentRow')}
              onPress={() => router.push('/payment-methods')}
            />
          ) : needsPayment ? (
            <ListRow
              icon="credit-card-off"
              iconTone="warning"
              title={t('evse.noPaymentRow')}
              subtitle={t('evse.paymentRow')}
              onPress={() => router.push('/payment-methods/new')}
            />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fact: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 26, color: colors.text },
  vDivider: { width: 1, height: 40, backgroundColor: colors.line },
  price: { ...text.titulo3, color: colors.text },
});
