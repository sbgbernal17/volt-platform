/**
 * Detalle de estación (handoff, pantallas 05 y 06): nombre, disponibilidad, cargadores
 * seleccionables con potencia, conector y estado, tarifa, acceso y horario. En sitio (o siempre, si
 * no hay ubicación) se elige un cargador y se continúa a la confirmación.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { EvseDetail, Location } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { ConnectorBadge } from '../../src/components/connector-badge.tsx';
import { Skeleton } from '../../src/components/skeleton.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import {
  formatDistance,
  formatKw,
  formatPerKwh,
  formatPowerType,
  formatStandard,
} from '../../src/lib/format.ts';
import { useUserLocation } from '../../src/lib/location.ts';
import {
  availability,
  chargerNumber,
  driveMinutes,
  isOpen24h,
  sortByDistance,
} from '../../src/lib/stations.ts';
import { colors, connectorVisual, fonts, spacing, text } from '../../src/theme/tokens.ts';
import {
  Badge,
  Body,
  Button,
  Card,
  ErrorBox,
  Heading,
  LinkText,
  Loading,
  Muted,
  Screen,
  Subtitle,
  Title,
  TopBar,
} from '../../src/theme/ui.tsx';
import { openDirections } from '../(tabs)/index.tsx';

export default function StationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, td, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const location = useUserLocation();
  const [selectedEvse, setSelectedEvse] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const locations = useQuery(() => auth.api.get<{ items: Location[] }>('/locations'), [], {
    intervalMs: 15_000,
  });
  const station = locations.data?.items.find((item) => item.id === id) ?? null;
  const firstEvse = station?.evses[0]?.evseId ?? '';
  const quote = useQuery(
    () => auth.api.get<EvseDetail>(`/evses/${encodeURIComponent(firstEvse)}`),
    [firstEvse],
    { enabled: Boolean(firstEvse) },
  );
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (locations.loading && !locations.data) return <Loading text={t('app.loading')} />;
  if (!station) {
    return (
      <Screen padded={false}>
        <TopBar onBack={back} backLabel={t('app.back')} />
        <View style={{ paddingHorizontal: spacing.list }}>
          <ErrorBox
            message={
              locations.error
                ? errorMessage(locations.error, t('app.offline'))
                : t('station.notFound')
            }
            onRetry={() => void locations.reload()}
            retryLabel={t('app.retry')}
          />
        </View>
      </Screen>
    );
  }
  const summary = availability(station.evses);
  const distance = sortByDistance([station], location.coords)[0]?.distanceKm ?? null;
  const price = quote.data?.tariff?.energy.pricePerKwhNow ?? null;
  const currency = quote.data?.tariff?.currency;
  const selected = station.evses.find((e) => e.evseId === selectedEvse) ?? null;
  const selectedIndex = station.evses.findIndex((e) => e.evseId === selectedEvse);
  const visible = showAll || station.evses.length <= 4 ? station.evses : station.evses.slice(0, 4);
  const meta = [
    distance !== null ? formatDistance(distance) : null,
    distance !== null ? t('map.driveTime', { minutes: driveMinutes(distance) }) : null,
    isOpen24h(station.openingHours) ? t('map.open24') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen
      dense
      padded={false}
      bottom={
        selected ? (
          <Button
            title={t('station.continueWith', { number: chargerNumber(selectedIndex) })}
            onPress={() => router.push(`/evse/${encodeURIComponent(selected.evseId)}`)}
          />
        ) : (
          <Button
            title={t('station.go')}
            icon="near-me"
            onPress={() => void openDirections(station)}
          />
        )
      }
    >
      <TopBar onBack={back} backLabel={t('app.back')} />
      <View style={{ paddingHorizontal: spacing.list, gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          <Title>{station.name}</Title>
          <Muted>{[station.address, station.city].filter(Boolean).join(' · ')}</Muted>
        </View>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}
        >
          {summary.available > 0 ? (
            <Badge
              tone="success"
              icon="check"
              text={t('station.availableBadge', {
                available: summary.available,
                total: summary.total,
              })}
            />
          ) : summary.noData ? (
            <Badge tone="neutral" icon="help-outline" text={t('visual.nodata')} dotted />
          ) : (
            <Badge tone="warning" icon="schedule" text={t('station.noneAvailable')} />
          )}
          {meta ? <Muted>{meta}</Muted> : null}
        </View>

        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
        >
          <Heading>{t('station.chooseCharger')}</Heading>
          {station.evses.length > 4 && !showAll ? (
            <LinkText
              onPress={() => setShowAll(true)}
            >{`${t('app.open')} ${station.evses.length}`}</LinkText>
          ) : null}
        </View>
        <Muted>{t('station.chooseHelp')}</Muted>
        {visible.map((evse, index) => {
          const visual = connectorVisual(evse.status);
          const usable = visual === 'available' || visual === 'nodata';
          const fast = evse.powerType === 'DC' || (evse.maxPowerKw ?? 0) >= 50;
          const support =
            visual === 'available'
              ? fast
                ? t('station.fast')
                : t('station.slow')
              : visual === 'occupied'
                ? t('station.inUse')
                : visual === 'nodata'
                  ? t('station.noData')
                  : t('station.outOfService');
          return (
            <Card
              key={evse.evseId}
              selected={evse.evseId === selectedEvse}
              dimmed={!usable}
              onPress={
                usable
                  ? () => setSelectedEvse(evse.evseId === selectedEvse ? null : evse.evseId)
                  : undefined
              }
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.ms }}>
                <Text style={styles.number}>{chargerNumber(index)}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.chargerTitle}>
                    {formatKw(evse.maxPowerKw)} {formatPowerType(evse.powerType, locale)}
                  </Text>
                  <Muted>
                    {formatStandard(evse.standard, locale)}
                    {price ? ` · ${formatPerKwh(price, currency)}` : ''}
                    {` · ${evse.evseId}`}
                  </Muted>
                </View>
                <ConnectorBadge status={evse.status} />
              </View>
              <Muted>{support}</Muted>
              <Text style={{ display: 'none' }}>{td(`status.${evse.status}`)}</Text>
            </Card>
          );
        })}

        <Card>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <Subtitle>{t('station.tariff')}</Subtitle>
            {quote.loading && !quote.data ? (
              <Skeleton width={96} height={24} />
            ) : (
              <Text style={styles.price}>
                {price ? formatPerKwh(price, currency) : t('station.noTariff')}
              </Text>
            )}
          </View>
          <Muted>{t('station.tariffNote')}</Muted>
        </Card>
        <Card>
          <Subtitle>{t('station.access')}</Subtitle>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Body>{td(`station.access.${station.accessType}`)}</Body>
            {isOpen24h(station.openingHours) ? <Muted>· {t('map.open24')}</Muted> : null}
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  number: {
    fontFamily: fonts.title,
    fontSize: 28,
    lineHeight: 32,
    color: colors.text,
    minWidth: 40,
  },
  chargerTitle: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.text },
  price: { ...text.titulo3, color: colors.text },
});
