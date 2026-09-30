/**
 * Actividad (handoff, pantallas 14 y 24): resumen del mes, sesiones agrupadas por mes con estación,
 * fecha, energía, duración y valor; pago pendiente cuando aplica; estado vacío e invitado.
 */
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Location, Session } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { Skeleton } from '../../src/components/skeleton.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { groupByMonth, hasPendingPayment, monthSummary } from '../../src/lib/activity.ts';
import { formatDateTime, formatDuration, formatKwh, formatMoney } from '../../src/lib/format.ts';
import { sessionPhase } from '../../src/lib/session-view.ts';
import { Icon } from '../../src/theme/icon.tsx';
import { colors, fonts, radius, spacing, text } from '../../src/theme/tokens.ts';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBox,
  Label,
  Muted,
  Screen,
  Title,
} from '../../src/theme/ui.tsx';

export default function History() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signedIn = auth.status === 'authenticated';
  const sessions = useQuery(
    () => auth.api.get<{ items: Session[] }>('/sessions', { limit: 50 }),
    [signedIn],
    { enabled: signedIn, intervalMs: 10_000 },
  );
  const locations = useQuery(() => auth.api.get<{ items: Location[] }>('/locations'), [], {});
  const items = sessions.data?.items ?? [];
  const groups = useMemo(() => groupByMonth(items, locale), [items, locale]);
  const summary = useMemo(() => monthSummary(items, locale), [items, locale]);
  const stationOf = (session: Session) =>
    locations.data?.items.find((l) => l.evses.some((e) => e.evseId === session.evseId))?.name ??
    session.chargeBoxId;

  const header = (
    <View style={{ paddingHorizontal: spacing.list, paddingTop: insets.top + spacing.md }}>
      <Title>{t('history.activity')}</Title>
    </View>
  );

  if (!signedIn) {
    return (
      <Screen dense padded={false}>
        {header}
        <View style={{ paddingHorizontal: spacing.list }}>
          <EmptyState
            icon="person"
            title={t('history.guestTitle')}
            text={t('history.guestBody')}
            action={
              <Button
                title={t('onboarding.create')}
                onPress={() => router.push('/(auth)/sign-up')}
              />
            }
          />
        </View>
      </Screen>
    );
  }
  if (sessions.loading && !sessions.data) {
    return (
      <Screen dense padded={false}>
        {header}
        <View style={{ paddingHorizontal: spacing.list, gap: spacing.ms }}>
          <Skeleton height={88} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      </Screen>
    );
  }
  return (
    <Screen dense padded={false}>
      {header}
      <View style={{ paddingHorizontal: spacing.list, gap: spacing.md }}>
        {sessions.error && !sessions.data ? (
          <ErrorBox
            message={errorMessage(sessions.error, t('app.offline'))}
            onRetry={() => void sessions.reload()}
            retryLabel={t('app.retry')}
          />
        ) : null}
        {items.length === 0 && !sessions.error ? (
          <EmptyState
            title={t('history.emptyTitle')}
            text={t('history.emptyBody')}
            action={
              <Button title={t('history.findStation')} onPress={() => router.replace('/(tabs)')} />
            }
          />
        ) : null}
        {items.length > 0 ? (
          <View style={styles.summary}>
            <View style={{ flex: 1, gap: 2 }}>
              <Label>{summary.label.split(' ')[0]}</Label>
              <Text style={styles.summaryValue}>
                {summary.charges === 1
                  ? t('history.chargesOne')
                  : t('history.chargesMany', { n: summary.charges })}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Label>{t('history.energy')}</Label>
              <Text style={styles.summaryValue}>{formatKwh(summary.energyKwh)}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Label>{t('history.total')}</Label>
              <Text style={styles.summaryValue}>
                {formatMoney(summary.totalMinor, summary.currency)}
              </Text>
            </View>
          </View>
        ) : null}
        {groups.map((group) => (
          <View key={group.key} style={{ gap: spacing.xs }}>
            <Label style={{ paddingTop: spacing.sm }}>{group.label}</Label>
            {group.sessions.map((session) => {
              const phase = sessionPhase(session);
              const live = phase === 'live' || phase === 'starting' || phase === 'stopping';
              const failed = phase === 'failed';
              const total = session.cost
                ? formatMoney(session.cost.total, session.cost.currency)
                : '—';
              return (
                <Pressable
                  key={session.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/session/${session.id}`)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View
                    style={[
                      styles.circle,
                      live
                        ? { backgroundColor: colors.infoSoft }
                        : failed
                          ? { backgroundColor: colors.field }
                          : null,
                    ]}
                  >
                    <Icon
                      name={failed ? 'block' : 'bolt'}
                      size={22}
                      color={live ? colors.info : failed ? colors.textSecondary : colors.danger}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.station}>{stationOf(session)}</Text>
                    <Muted>
                      {[
                        formatDateTime(session.startedAt ?? session.requestedAt, locale).split(
                          ',',
                        )[0],
                        session.energyKwh !== null ? formatKwh(session.energyKwh) : null,
                        session.elapsedSeconds > 0 ? formatDuration(session.elapsedSeconds) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Muted>
                    {live ? (
                      <Badge tone="info" icon="bolt" text={t('session.charging')} />
                    ) : failed ? (
                      <Badge
                        tone="neutral"
                        icon="block"
                        text={t(
                          `session.state.${session.state === 'FAILED' ? 'FAILED' : session.state === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED'}`,
                        )}
                        outlined
                      />
                    ) : hasPendingPayment(session) ? (
                      <Badge tone="warning" icon="schedule" text={t('history.paymentPending')} />
                    ) : null}
                  </View>
                  <Text style={styles.amount}>
                    {live ? `${t('session.costSoFar')} ${total}` : total}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  summaryValue: {
    fontFamily: fonts.bodyBold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.ms,
    paddingVertical: spacing.ms,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  station: { ...text.cuerpo, color: colors.text },
  amount: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});
