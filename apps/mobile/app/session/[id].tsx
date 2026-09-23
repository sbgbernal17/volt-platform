/**
 * Carga en vivo: estado, energía, potencia, batería, tiempo, costo acumulado y límite (sondeo cada
 * 2 s mientras la sesión sigue abierta), avisos de pausa y ocupación, parada y recibo.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Session } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import {
  ACTIVE_STATES,
  displayState,
  isSessionOpen,
  sessionTone,
} from '../../src/components/session-item.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import {
  formatClock,
  formatDuration,
  formatKw,
  formatKwh,
  formatMoney,
  formatPercent,
} from '../../src/lib/format.ts';
import { spacing } from '../../src/theme/tokens.ts';
import {
  Badge,
  Big,
  Body,
  Button,
  Card,
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

function confirmStop(title: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(title));
  return new Promise((resolve) => {
    Alert.alert(title, undefined, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, td } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const session = useQuery(
    async () => {
      const result = await auth.api.get<Session>(`/sessions/${id}`);
      setOpen(isSessionOpen(result));
      return result;
    },
    [id],
    { enabled: Boolean(id), intervalMs: open ? 2000 : 0 },
  );
  const data = session.data;

  const stop = async () => {
    if (!data || !(await confirmStop(t('session.stopConfirm'), t('session.stop'), t('app.cancel'))))
      return;
    setBusy(true);
    setActionError(null);
    try {
      await auth.api.post(`/sessions/${data.id}/stop`);
      await session.reload();
    } catch (caught) {
      setActionError(errorMessage(caught, t('app.offline')));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await auth.api.post(`/sessions/${data.id}/cancel`);
      await session.reload();
    } catch (caught) {
      setActionError(errorMessage(caught, t('app.offline')));
    } finally {
      setBusy(false);
    }
  };

  if (session.loading && !data) return <Loading text={t('app.loading')} />;
  if (session.error && !data) {
    return (
      <Screen>
        <ErrorBox
          message={errorMessage(session.error, t('app.offline'))}
          onRetry={() => void session.reload()}
          retryLabel={t('app.retry')}
        />
      </Screen>
    );
  }
  if (!data) return null;
  const cost = data.cost;
  const total = cost ? formatMoney(cost.total, cost.currency) : '—';
  const state = displayState(data);
  const active = ACTIVE_STATES.has(state);
  const paused = data.detailedState === 'SUSPENDED_EV' || data.detailedState === 'SUSPENDED_EVSE';
  const idleRunning = data.state === 'ENDED' && data.idleSince && !data.idleEndedAt;
  const warn = cost?.alerts.includes('PREAUTH_WARN') || cost?.alerts.includes('PREAUTH_EXHAUSTED');
  const failureKey = data.failureCode ? `session.failedCode.${data.failureCode}` : null;

  return (
    <Screen>
      <Row between>
        <Title>{td(`session.state.${state}`)}</Title>
        <Badge tone={sessionTone(state)} text={data.sessionNo} />
      </Row>
      <Muted>
        {t('session.chargerCode', {
          chargeBoxId: data.chargeBoxId,
          connectorId: data.connectorId ?? '—',
        })}{' '}
        · {data.evseId}
      </Muted>
      {data.state === 'STARTING' && data.startDeadlineAt ? (
        <Notice tone="info">
          {t('session.startingHelp', { deadline: formatClock(data.startDeadlineAt) })}
        </Notice>
      ) : null}
      {state === 'FAILED' || state === 'EXPIRED' ? (
        <Notice tone="danger">
          {failureKey && td(failureKey) !== failureKey ? td(failureKey) : t('session.failed')}
        </Notice>
      ) : null}
      {paused && active ? <Notice tone="warning">{t('session.paused')}</Notice> : null}
      {idleRunning ? (
        <Notice tone="warning">
          {t('session.idleRunning', { time: formatClock(data.idleSince) })}
        </Notice>
      ) : null}
      <Card>
        <Row style={{ gap: spacing.lg }}>
          <KeyValue label={t('session.energy')} value={formatKwh(data.energyKwh)} big />
          <KeyValue label={t('session.power')} value={active ? formatKw(data.powerKw) : '—'} big />
          {data.soc !== null ? (
            <KeyValue label={t('session.soc')} value={formatPercent(data.soc)} big />
          ) : null}
          <KeyValue label={t('session.elapsed')} value={formatDuration(data.elapsedSeconds)} big />
        </Row>
      </Card>
      <Card>
        <Row between>
          <Heading>{cost?.isFinal ? t('session.total') : t('session.costSoFar')}</Heading>
          <Big>{total}</Big>
        </Row>
        {cost && !cost.isFinal ? <Muted>{t('session.estimated')}</Muted> : null}
        {data.exposureLimit ? (
          <Row between>
            <Muted>{t('session.limit')}</Muted>
            <Body>{formatMoney(data.exposureLimit, cost?.currency ?? 'COP')}</Body>
          </Row>
        ) : null}
        {warn ? <Notice tone="warning">{t('session.limitWarn')}</Notice> : null}
        {!active && state !== 'FAILED' && state !== 'EXPIRED' && state !== 'CANCELLED' ? (
          <Muted>
            {data.paymentStatus === 'CAPTURED'
              ? t('session.payment.CAPTURED')
              : data.paymentStatus === 'FAILED'
                ? t('session.payment.FAILED')
                : data.paymentStatus === 'WAIVED'
                  ? t('session.payment.WAIVED')
                  : t('session.payment.pending')}
          </Muted>
        ) : null}
      </Card>
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      <View style={{ gap: spacing.sm }}>
        {data.links.stop && data.state === 'ACTIVE' ? (
          <Button title={t('session.stop')} onPress={() => void stop()} loading={busy} />
        ) : null}
        {data.state === 'REQUESTED' || data.state === 'STARTING' ? (
          <Button
            title={t('session.cancel')}
            variant="secondary"
            onPress={() => void cancel()}
            loading={busy}
          />
        ) : null}
        {data.receipt ? (
          <Button
            title={t('session.receipt')}
            variant="secondary"
            onPress={() => router.push(`/receipt/${data.id}`)}
          />
        ) : null}
      </View>
    </Screen>
  );
}
