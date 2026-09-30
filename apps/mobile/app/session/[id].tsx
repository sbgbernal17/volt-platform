/**
 * Carga (handoff, pantallas 09 a 12, 19, 21 y 22). Según la fase de la sesión: "Conecte su
 * vehículo" con pasos mientras arranca; carga en vivo con anillo, datos y parada; diálogo de
 * finalización; carga completada con resumen y recibo; falla del cargador o inicio fallido.
 * Sondeo cada 2 s mientras la sesión sigue abierta.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Linking, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Location, Session } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { ChargeRing } from '../../src/components/charge-ring.tsx';
import { Dialog } from '../../src/components/dialog.tsx';
import { isSessionOpen } from '../../src/components/session-item.tsx';
import { StepList } from '../../src/components/step-list.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import {
  formatClock,
  formatDateTime,
  formatDuration,
  formatKw,
  formatKwh,
  formatMoney,
  formatStandard,
} from '../../src/lib/format.ts';
import {
  formatClockDuration,
  isStale,
  minutesAgo,
  ringProgress,
  sessionPhase,
  stoppedByFault,
  supportCode,
} from '../../src/lib/session-view.ts';
import { chargerNumber } from '../../src/lib/stations.ts';
import { useActiveSession } from '../../src/session/active-session.tsx';
import { Icon } from '../../src/theme/icon.tsx';
import { colors, fonts, radius, spacing, text } from '../../src/theme/tokens.ts';
import {
  Badge,
  Body,
  Button,
  Card,
  DataRow,
  Display,
  ErrorBox,
  IconButton,
  LinkText,
  Loading,
  MetricTile,
  Muted,
  Note,
  Notice,
  Screen,
  Title,
  TopBar,
} from '../../src/theme/ui.tsx';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, td, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const activeSession = useActiveSession();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
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
  const locations = useQuery(() => auth.api.get<{ items: Location[] }>('/locations'), [], {});
  const data = session.data;
  const station = data
    ? (locations.data?.items.find((item) => item.evses.some((e) => e.evseId === data.evseId)) ??
      null)
    : null;
  const evse = station?.evses.find((e) => e.evseId === data?.evseId) ?? null;
  const index = station && data ? station.evses.findIndex((e) => e.evseId === data.evseId) : -1;
  const chargerLabel =
    index >= 0
      ? t('evse.confirmTitle', { number: chargerNumber(index) })
      : (data?.chargeBoxId ?? '');
  const standard = evse ? formatStandard(evse.standard, locale) : '';
  const toMap = () => router.replace('/(tabs)');

  const stop = async () => {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      await auth.api.post(`/sessions/${data.id}/stop`);
      setConfirmStop(false);
      await session.reload();
      await activeSession.refresh();
    } catch (caught) {
      setActionError(errorMessage(caught, t('app.offline')));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      await auth.api.post(`/sessions/${data.id}/cancel`);
      await session.reload();
      await activeSession.refresh();
    } catch (caught) {
      setActionError(errorMessage(caught, t('app.offline')));
    } finally {
      setBusy(false);
    }
  };
  const support = auth.config?.legal.supportEmail ?? null;
  const report = () => {
    if (!support || !data) return;
    const subject = encodeURIComponent(`Volt · ${supportCode(data)}`);
    void Linking.openURL(`mailto:${support}?subject=${subject}`).catch(() => undefined);
  };

  if (session.loading && !data) return <Loading text={t('app.loading')} />;
  if (session.error && !data) {
    return (
      <Screen padded={false}>
        <TopBar onBack={toMap} backLabel={t('app.back')} />
        <View style={{ paddingHorizontal: spacing.list }}>
          <ErrorBox
            message={errorMessage(session.error, t('app.offline'))}
            onRetry={() => void session.reload()}
            retryLabel={t('app.retry')}
          />
        </View>
      </Screen>
    );
  }
  if (!data) return null;

  const phase = sessionPhase(data);
  const cost = data.cost;
  const total = cost ? formatMoney(cost.total, cost.currency) : '—';
  const stale = isStale(data) || Boolean(session.error);
  const paused = data.detailedState === 'SUSPENDED_EV' || data.detailedState === 'SUSPENDED_EVSE';
  const warn = cost?.alerts.includes('PREAUTH_WARN') || cost?.alerts.includes('PREAUTH_EXHAUSTED');
  const failureKey = data.failureCode ? `session.failedCode.${data.failureCode}` : null;
  const failureText =
    failureKey && td(failureKey) !== failureKey ? td(failureKey) : t('session.failed');

  // ---- 09: Conecte su vehículo ----
  if (phase === 'starting') {
    return (
      <Screen
        dense
        padded={false}
        bottom={
          <Button
            title={t('session.cancel')}
            variant="secondary"
            onPress={() => void cancel()}
            loading={busy}
          />
        }
      >
        <TopBar onBack={toMap} backLabel={t('app.back')} />
        <View style={{ paddingHorizontal: spacing.list, gap: spacing.md }}>
          <View style={{ gap: spacing.xs }}>
            <Muted>{t('session.chargerLine', { charger: chargerLabel, standard })}</Muted>
            <Title>{t('session.connectTitle')}</Title>
          </View>
          <View style={styles.illustration}>
            <View style={styles.plug}>
              <Icon name="ev-station" size={72} color={colors.text} />
            </View>
            <View style={styles.plugDots}>
              <View style={styles.plugDot} />
              <View style={styles.plugDot} />
            </View>
          </View>
          <StepList
            steps={[
              { label: t('session.step1', { standard }), state: 'done' },
              { label: t('session.step2'), state: 'current' },
              { label: t('session.step3'), state: 'pending' },
            ]}
          />
          <Notice tone="neutral" icon="electrical-services">
            {t('session.waitingPlug')}
            {data.startDeadlineAt
              ? ` ${t('session.startingHelp', { deadline: formatClock(data.startDeadlineAt) })}`
              : ''}
          </Notice>
          {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        </View>
      </Screen>
    );
  }

  // ---- 10, 11 y 19: carga en vivo ----
  if (phase === 'live' || phase === 'stopping') {
    const progress = ringProgress(data);
    const stopping = phase === 'stopping';
    return (
      <Screen
        dense
        padded={false}
        bottom={
          <Button
            title={stopping ? t('session.stopping') : t('session.stop')}
            variant="secondary"
            icon="stop-circle"
            onPress={() => setConfirmStop(true)}
            disabled={stopping || !data.links.stop}
            loading={busy && !confirmStop}
          />
        }
      >
        <TopBar
          onBack={toMap}
          backLabel={t('session.minimize')}
          backIcon="keyboard-arrow-down"
          title={station?.name ?? data.chargeBoxId}
          subtitle={t('session.chargerLine', {
            charger: chargerLabel,
            standard: standard || data.evseId,
          })}
          right={
            support ? (
              <IconButton icon="help-outline" label={t('session.help')} onPress={report} />
            ) : undefined
          }
        />
        <View style={{ alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.list }}>
          {stale ? (
            <Badge
              tone="warning"
              icon="sync-problem"
              text={t('session.staleBadge', {
                minutes: minutesAgo(data.lastSampleAt ?? data.startedAt),
              })}
            />
          ) : stopping ? (
            <Badge tone="info" icon="schedule" text={t('session.stopping')} />
          ) : (
            <LiveBadge label={t('session.live')} />
          )}
          <ChargeRing progress={progress} stale={stale}>
            {progress !== null ? (
              <View style={{ alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <Text style={[styles.ringValue, stale && { color: colors.textMuted }]}>
                    {Math.round(data.soc ?? 0)}
                  </Text>
                  <Text style={[styles.ringUnit, stale && { color: colors.textMuted }]}>%</Text>
                </View>
                <Muted>{t('session.battery')}</Muted>
              </View>
            ) : (
              <View style={{ alignItems: 'center' }}>
                <Text style={[styles.ringValueSmall, stale && { color: colors.textMuted }]}>
                  {formatKwh(data.energyKwh).replace(' kWh', '')}
                </Text>
                <Muted>kWh</Muted>
              </View>
            )}
          </ChargeRing>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name={paused ? 'pause-circle-outline' : 'bolt'} size={22} color={colors.info} />
            <Body>
              {paused
                ? t('session.pausedShort')
                : data.powerKw
                  ? `${t('session.charging')} · ${formatKw(data.powerKw)}`
                  : t('session.charging')}
            </Body>
          </View>
        </View>
        <View style={{ paddingHorizontal: spacing.list, gap: spacing.ms, paddingTop: spacing.md }}>
          {stale ? (
            <Notice
              tone="warning"
              icon="wifi-off"
              action={
                <Button
                  title={t('session.retryConnection')}
                  variant="secondary"
                  compact
                  onPress={() => void session.reload()}
                />
              }
            >
              <View style={{ gap: 2 }}>
                <Text style={{ ...text.etiqueta, color: colors.warning }}>
                  {t('session.staleTitle')}
                </Text>
                <Muted>{t('session.staleBody')}</Muted>
                {data.lastSampleAt ? (
                  <Muted>{t('session.staleLast', { time: formatClock(data.lastSampleAt) })}</Muted>
                ) : null}
              </View>
            </Notice>
          ) : null}
          <View style={styles.grid}>
            <MetricTile
              label={t('session.energy')}
              value={formatKwh(data.energyKwh).replace(' kWh', '')}
              unit="kWh"
              stale={stale}
            />
            <MetricTile
              label={t('session.power')}
              value={formatKw(data.powerKw).replace(' kW', '')}
              unit="kW"
              stale={stale}
            />
          </View>
          <View style={styles.grid}>
            <MetricTile
              label={t('session.elapsed')}
              value={formatClockDuration(data.elapsedSeconds)}
              stale={stale}
            />
            <MetricTile
              label={cost?.isFinal ? t('session.total') : t('session.costSoFar')}
              value={total}
              stale={stale}
            />
          </View>
          {evse && (evse.chargerMaxPowerKw ?? evse.maxPowerKw) ? (
            <Note style={{ textAlign: 'center' }}>
              {t(evse.powerShared ? 'session.maxPowerSharedNote' : 'session.maxPowerNote', {
                power: formatKw(evse.chargerMaxPowerKw ?? evse.maxPowerKw),
              })}
            </Note>
          ) : null}
          {warn ? <Notice tone="warning">{t('session.limitWarn')}</Notice> : null}
          {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        </View>
        <Dialog
          visible={confirmStop}
          title={t('session.stopDialogTitle')}
          note={t('session.stopDialogNote')}
          primary={{
            title: busy ? t('session.stopping') : t('session.finish'),
            onPress: () => void stop(),
            loading: busy,
          }}
          secondary={{ title: t('session.keepCharging'), onPress: () => setConfirmStop(false) }}
          onClose={() => (busy ? undefined : setConfirmStop(false))}
        >
          <View>
            <DataRow label={t('session.energy')} value={formatKwh(data.energyKwh)} strong />
            <DataRow
              label={t('session.elapsed')}
              value={formatDuration(data.elapsedSeconds)}
              strong
            />
            <DataRow label={t('session.costEstimated')} value={total} strong />
          </View>
        </Dialog>
      </Screen>
    );
  }

  // ---- 12 y 22: carga completada (o detenida por falla) ----
  if (phase === 'completed') {
    const fault = stoppedByFault(data);
    const idleRunning = data.state === 'ENDED' && data.idleSince && !data.idleEndedAt;
    const paymentText =
      data.paymentStatus === 'CAPTURED'
        ? t('session.payment.CAPTURED')
        : data.paymentStatus === 'FAILED'
          ? t('session.payment.FAILED')
          : data.paymentStatus === 'WAIVED'
            ? t('session.payment.WAIVED')
            : t('session.payment.pending');
    return (
      <Screen
        dense
        padded={false}
        bottom={
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {data.receipt ? (
              <Button
                title={t('session.receipt')}
                variant="secondary"
                onPress={() => router.push(`/receipt/${data.id}`)}
                style={{ flex: 1, width: undefined }}
              />
            ) : null}
            <Button
              title={t('session.backToMap')}
              onPress={toMap}
              style={{ flex: 1, width: undefined }}
            />
          </View>
        }
      >
        <TopBar onBack={toMap} backLabel={t('app.back')} backIcon="close" />
        <View style={{ paddingHorizontal: spacing.list, gap: spacing.md }}>
          <View style={[styles.checkCircle, fault && { backgroundColor: colors.dangerSoft }]}>
            <Icon
              name={fault ? 'report' : 'check'}
              size={32}
              color={fault ? colors.danger : colors.success}
            />
          </View>
          <Display>{fault ? t('session.faultTitle') : t('session.completedTitle')}</Display>
          {fault ? (
            <Body style={{ color: colors.textSecondary }}>
              {t('session.faultBody', { time: formatClock(data.endedAt) })}
            </Body>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={styles.hero}>{formatKwh(data.energyKwh).replace(' kWh', '')}</Text>
            <Text style={styles.heroUnit}>kWh</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <View style={{ gap: 2 }}>
              <Muted>{t('session.duration')}</Muted>
              <Text style={styles.fact}>{formatDuration(data.elapsedSeconds)}</Text>
            </View>
            <View style={{ gap: 2 }}>
              <Muted>{cost?.isFinal ? t('session.total') : t('session.costEstimated')}</Muted>
              <Text style={styles.fact}>{total}</Text>
            </View>
          </View>
          <View>
            <DataRow label={t('session.station')} value={station?.name ?? data.chargeBoxId} />
            <DataRow
              label={t('session.charger')}
              value={standard ? `${chargerLabel} · ${standard}` : chargerLabel}
            />
            <DataRow
              label={t('session.date')}
              value={formatDateTime(data.endedAt ?? data.startedAt ?? data.requestedAt, locale)}
            />
            <DataRow label={t('session.paymentLabel')} value={paymentText} />
          </View>
          {data.paymentStatus === 'FAILED' ? (
            <Notice
              tone="danger"
              icon="credit-card-off"
              action={
                <LinkText onPress={() => router.push('/debts')}>{t('session.viewDebts')}</LinkText>
              }
            >
              {t('session.paymentFailedBody')}
            </Notice>
          ) : null}
          {idleRunning ? (
            <Notice tone="warning" icon="schedule">
              {t('session.idleRunning', { time: formatClock(data.idleSince) })}
            </Notice>
          ) : data.state === 'ENDED' ? (
            <Notice tone="info" icon="info">
              {t('session.unplug')}
            </Notice>
          ) : null}
          {fault ? (
            <Card>
              <Note>{t('session.supportCode', { code: supportCode(data) })}</Note>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {station ? (
                  <Button
                    title={t('session.otherCharger')}
                    variant="secondary"
                    compact
                    onPress={() => router.replace(`/station/${station.id}`)}
                    style={{ flex: 1, width: undefined }}
                  />
                ) : null}
                {support ? (
                  <Button
                    title={t('session.report')}
                    variant="ghost"
                    compact
                    onPress={report}
                    style={{ flex: 1, width: undefined }}
                  />
                ) : null}
              </View>
            </Card>
          ) : null}
        </View>
      </Screen>
    );
  }

  // ---- 21 y variantes: no inició, cancelada o sin conexión del vehículo ----
  const title =
    data.state === 'CANCELLED'
      ? t('session.cancelledTitle')
      : data.detailedState === 'EXPIRED' || data.failureCode === 'CONNECTION_TIMEOUT'
        ? t('session.expiredTitle')
        : t('session.notStartedTitle');
  const paymentFailure = [
    'NO_PAYMENT_METHOD',
    'PAYMENT_METHOD_PENDING',
    'DEBT_PENDING',
    'PAYMENT_DECLINED',
  ].includes(data.failureCode ?? '');
  return (
    <Screen
      dense
      padded={false}
      bottom={
        <View style={{ gap: spacing.sm }}>
          {paymentFailure ? (
            <Button
              title={t('evse.useOtherCard')}
              icon="credit-card"
              onPress={() => router.replace('/payment-methods/new')}
            />
          ) : station ? (
            <Button
              title={t('session.otherCharger')}
              onPress={() => router.replace(`/station/${station.id}`)}
            />
          ) : null}
          <Button title={t('session.backToMap')} variant="secondary" onPress={toMap} />
        </View>
      }
    >
      <TopBar onBack={toMap} backLabel={t('app.back')} backIcon="close" />
      <View style={{ paddingHorizontal: spacing.list, gap: spacing.md }}>
        <View style={[styles.checkCircle, { backgroundColor: colors.dangerSoft }]}>
          <Icon name="error" size={32} color={colors.danger} />
        </View>
        <Title>{title}</Title>
        {data.state !== 'CANCELLED' ? (
          <StepList
            steps={[
              { label: t('evse.stepCharger'), state: 'done' },
              paymentFailure
                ? { label: t('evse.stepPayment'), state: 'error', detail: failureText }
                : { label: t('evse.stepPayment'), state: 'done' },
              paymentFailure
                ? { label: t('evse.stepStart'), state: 'pending' }
                : { label: t('evse.stepStart'), state: 'error', detail: failureText },
            ]}
          />
        ) : null}
        {paymentFailure ? (
          <Notice tone="danger" icon="credit-card-off">
            {t('evse.noCharge')}
          </Notice>
        ) : null}
        <DataRow label={t('session.station')} value={station?.name ?? data.chargeBoxId} />
        <DataRow label={t('session.charger')} value={chargerLabel} />
      </View>
    </Screen>
  );
}

/** Insignia "En vivo" con punto azul que pulsa cada 2 s (se detiene con "Reducir movimiento"). */
function LiveBadge({ label }: { label: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.35, duration: 1000, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
          ]),
        );
        loop.start();
      });
    return () => loop?.stop();
  }, [opacity]);
  return (
    <View style={styles.liveBadge}>
      <Animated.View style={[styles.liveDot, { opacity }]} />
      <Text style={styles.liveText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  illustration: {
    height: 190,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  plug: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plugDots: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: colors.brand,
  },
  plugDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brand },
  ringValue: { ...text.datoXL, color: colors.text },
  ringUnit: {
    fontFamily: fonts.title,
    fontSize: 36,
    lineHeight: 44,
    color: colors.text,
    paddingTop: 12,
  },
  ringValueSmall: {
    fontFamily: fonts.title,
    fontSize: 56,
    lineHeight: 60,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  grid: { flexDirection: 'row', gap: spacing.ms },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: radius.circle,
    backgroundColor: colors.infoSoft,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.info },
  liveText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.text },
  checkCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    fontFamily: fonts.title,
    fontSize: 56,
    lineHeight: 60,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  heroUnit: { fontFamily: fonts.titleMedium, fontSize: 24, color: colors.textSecondary },
  fact: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 26, color: colors.text },
});
