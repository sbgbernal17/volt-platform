/**
 * Detalle del conector: estado en vivo y precio desagregado antes de cargar (Resolución 40123):
 * energía por franjas, ocupación con gracia, cargo por sesión, límite y nota de impuestos.
 * El botón inicia la carga con la cotización vista (`quoteId`) y una clave de idempotencia.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Billing, EvseDetail, Session, SessionStartError } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { formatClock, formatKw, formatMoney, formatPerKwh } from '../../src/lib/format.ts';
import { connectorTone, spacing } from '../../src/theme/tokens.ts';
import {
  Badge,
  Big,
  Body,
  Button,
  Card,
  Divider,
  ErrorBox,
  Heading,
  KeyValue,
  Loading,
  Muted,
  Notice,
  Row,
  Screen,
  Title,
} from '../../src/theme/ui.tsx';

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function bandLabel(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  const clock = (hhmm: string) => {
    const [h = '0', m = '00'] = hhmm.split(':');
    const hour = Number(h);
    return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${hour < 12 ? 'a. m.' : 'p. m.'}`;
  };
  return `${start ? clock(start) : ''} – ${end ? clock(end) : ''}`;
}

export default function EvseScreen() {
  const { evseId } = useLocalSearchParams<{ evseId: string }>();
  const { t, td } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ text: string; needPayment?: boolean } | null>(
    null,
  );
  const idempotencyKey = useMemo(() => randomKey(), []);
  const evse = useQuery(
    () => auth.api.get<EvseDetail>(`/evses/${encodeURIComponent(evseId ?? '')}`),
    [evseId],
    {
      enabled: Boolean(evseId),
      intervalMs: 10_000,
    },
  );
  const billing = useQuery(() => auth.api.get<Billing>('/billing'), [], {});
  const data = evse.data;
  const tariff = data?.tariff ?? null;
  const canStart = Boolean(
    data && tariff && (data.status === 'Available' || data.status === 'Preparing'),
  );

  const start = async () => {
    if (!data) return;
    setStarting(true);
    setStartError(null);
    try {
      const session = await auth.api.post<Session>(
        '/sessions',
        { evseId: data.evseId, ...(tariff ? { quoteId: tariff.quoteId } : {}) },
        { 'idempotency-key': idempotencyKey },
      );
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
        if (
          caught.status === 409 &&
          caught.body &&
          typeof caught.body === 'object' &&
          'session' in caught.body
        ) {
          const failed = caught.body as SessionStartError;
          const code = failed.session.failureCode ?? failed.error.code;
          const key = `session.failedCode.${code}`;
          const text = td(key) === key ? t('session.failedCode.other') : td(key);
          setStartError({
            text,
            needPayment: code === 'NO_PAYMENT_METHOD' || code === 'PAYMENT_METHOD_PENDING',
          });
          return;
        }
        if (caught.code === 'CHARGER_OFFLINE') {
          setStartError({ text: t('session.failedCode.CHARGER_OFFLINE') });
          return;
        }
      }
      setStartError({ text: errorMessage(caught, t('app.offline')) });
    } finally {
      setStarting(false);
    }
  };

  if (evse.loading && !data) return <Loading text={t('app.loading')} />;
  if (evse.error && !data) {
    const notFound = evse.error instanceof ApiError && evse.error.status === 404;
    return (
      <Screen>
        <ErrorBox
          message={
            notFound
              ? t('evse.notFound', { id: evseId ?? '' })
              : errorMessage(evse.error, t('app.offline'))
          }
          onRetry={() => void evse.reload()}
          retryLabel={t('app.retry')}
        />
      </Screen>
    );
  }
  if (!data) return null;
  const standard = data.standard
    .replace('IEC_62196_T2_COMBO', 'CCS2')
    .replace('IEC_62196_T1_COMBO', 'CCS1')
    .replace('IEC_62196_T2', 'Tipo 2')
    .replace('GBT_DC', 'GB/T');

  return (
    <Screen>
      <Row between>
        <Title>{data.evseId}</Title>
        <Badge tone={connectorTone(data.status)} text={td(`status.${data.status}`)} />
      </Row>
      <Row style={{ gap: spacing.lg }}>
        <KeyValue label={t('evse.charger')} value={data.chargeBoxId} />
        <KeyValue label={t('evse.connector')} value={String(data.connectorId ?? '—')} />
        <KeyValue label={t('evse.power')} value={formatKw(data.maxPowerKw)} />
        <KeyValue label={t('evse.standard')} value={standard} />
      </Row>
      <Card>
        <Heading>{t('evse.priceTitle')}</Heading>
        {tariff ? (
          <>
            <Row between>
              <Muted>{t('evse.energyNow')}</Muted>
              <Big>{formatPerKwh(tariff.energy.pricePerKwhNow, tariff.currency)}</Big>
            </Row>
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
            <Muted>{t('evse.idle')}</Muted>
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
            {tariff.exposureLimit ? (
              <Body>
                {t('evse.limitText', { limit: formatMoney(tariff.exposureLimit, tariff.currency) })}
              </Body>
            ) : null}
            <Muted>{t('evse.vat')}</Muted>
            <Muted>{t('evse.quoteValid', { time: formatClock(tariff.validUntil) })}</Muted>
          </>
        ) : (
          <Notice tone="warning">{t('evse.noTariff')}</Notice>
        )}
      </Card>
      {billing.data && !billing.data.canCharge && billing.data.reason ? (
        <Notice tone="warning">
          {td(`session.failedCode.${billing.data.reason.code}`) ===
          `session.failedCode.${billing.data.reason.code}`
            ? billing.data.reason.message
            : td(`session.failedCode.${billing.data.reason.code}`)}
        </Notice>
      ) : null}
      {data.status !== 'Available' && data.status !== 'Preparing' ? (
        <Notice tone="info">
          {data.status === 'Unavailable' || data.status === 'Faulted'
            ? t('evse.unavailable', { id: data.evseId })
            : t('evse.busy')}
        </Notice>
      ) : null}
      {startError ? <Notice tone="danger">{startError.text}</Notice> : null}
      {startError?.needPayment ||
      (billing.data &&
        !billing.data.canCharge &&
        billing.data.reason?.code === 'NO_PAYMENT_METHOD') ? (
        <Button
          title={t('evse.addPayment')}
          variant="secondary"
          onPress={() => router.push('/payment-methods/new')}
        />
      ) : null}
      <Button
        title={t('evse.start')}
        onPress={() => void start()}
        loading={starting}
        disabled={!canStart}
      />
    </Screen>
  );
}
