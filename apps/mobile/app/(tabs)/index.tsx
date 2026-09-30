/**
 * Mapa (handoff, pantallas 02, 03, 04 y 23): mapa a pantalla completa con búsqueda, chips de
 * filtro, marcadores píldora, ubicación del conductor y hoja inferior con las estaciones cercanas o
 * la estación elegida. La lista es la alternativa accesible y la vista de la web sin mapa.
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { EvseDetail, Location } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { BottomSheet } from '../../src/components/bottom-sheet.tsx';
// Sin extensión: Metro elige site-map.native.tsx o site-map.web.tsx según la plataforma.
import { SiteMap } from '../../src/components/site-map';
import type { SiteMapProps } from '../../src/components/site-map.types.ts';
import { Skeleton } from '../../src/components/skeleton.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { formatDistance, formatKw, formatPerKwh } from '../../src/lib/format.ts';
import { useUserLocation } from '../../src/lib/location.ts';
import {
  activeFilterCount,
  availability,
  connectorGroups,
  directionsUrl,
  driveMinutes,
  filterStations,
  isOnSite,
  isOpen24h,
  NO_FILTERS,
  type StationFilters,
  type StationWithDistance,
  sortByDistance,
} from '../../src/lib/stations.ts';
import { Icon } from '../../src/theme/icon.tsx';
import { colors, fonts, radius, size, spacing, text } from '../../src/theme/tokens.ts';
import {
  Badge,
  Button,
  Chip,
  Heading,
  IconButton,
  LinkText,
  Loading,
  Muted,
  Notice,
  Screen,
  Subtitle,
  Title,
  Toggle,
} from '../../src/theme/ui.tsx';

const POWER_STEPS = [0, 50, 100, 150];

export async function openDirections(location: Location): Promise<void> {
  const url = directionsUrl(location, Platform.OS);
  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(directionsUrl(location, 'web')).catch(() => undefined);
  }
}

export default function MapScreen() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // En el navegador hay mapa solo si el ambiente entrega la clave de Google Maps (GET /v1/config).
  const hasMap = Platform.OS !== 'web' || Boolean(auth.config?.maps.browserKey);
  const [view, setView] = useState<'map' | 'list'>(hasMap ? 'map' : 'list');
  const [filters, setFilters] = useState<StationFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<SiteMapProps['focus']>(null);
  const focusKey = useRef(0);
  const location = useUserLocation();
  const locations = useQuery(() => auth.api.get<{ items: Location[] }>('/locations'), [], {
    intervalMs: 15_000,
  });
  const lastOk = useRef<number | null>(null);
  useEffect(() => {
    if (locations.data) lastOk.current = Date.now();
  }, [locations.data]);

  const items = locations.data?.items ?? [];
  const filtered = useMemo(() => filterStations(items, filters), [items, filters]);
  const sorted = useMemo(
    () => sortByDistance(filtered, location.coords),
    [filtered, location.coords],
  );
  const selected = sorted.find((s) => s.location.id === selectedId) ?? null;
  const withFree = sorted.filter((s) => availability(s.location.evses).available > 0);
  const nearest = withFree[0] ?? sorted[0] ?? null;
  const standards = useMemo(
    () =>
      connectorGroups(
        items.flatMap((l) => l.evses),
        locale,
      ),
    [items, locale],
  );

  const select = (station: StationWithDistance | null) => {
    setSelectedId(station?.location.id ?? null);
    if (station) {
      focusKey.current += 1;
      setFocus({ coords: station.location, zoom: 'near', key: focusKey.current });
    }
  };
  const locate = async () => {
    const coords = location.coords ?? (await location.request());
    if (!coords) return;
    focusKey.current += 1;
    setFocus({ coords, zoom: 'wide', key: focusKey.current });
  };

  if (locations.loading && !locations.data) return <Loading text={t('app.loading')} />;

  const offline = locations.error && locations.data && lastOk.current;
  const offlineMinutes = offline
    ? Math.max(1, Math.round((Date.now() - (lastOk.current ?? 0)) / 60_000))
    : 0;
  const chips = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.float }}
      style={{ flexGrow: 0 }}
    >
      <Chip
        label={t('map.availableNow')}
        active={filters.availableNow}
        onPress={() => setFilters({ ...filters, availableNow: !filters.availableNow })}
      />
      {standards.map((group) => (
        <Chip
          key={group.standard}
          label={group.label}
          active={filters.standards.includes(group.standard)}
          onPress={() =>
            setFilters({
              ...filters,
              standards: filters.standards.includes(group.standard)
                ? filters.standards.filter((s) => s !== group.standard)
                : [...filters.standards, group.standard],
            })
          }
        />
      ))}
      <Chip
        label="100 kW+"
        active={filters.minPowerKw === 100}
        onPress={() => setFilters({ ...filters, minPowerKw: filters.minPowerKw === 100 ? 0 : 100 })}
      />
    </ScrollView>
  );
  const search = (
    <View style={styles.searchRow}>
      <View style={styles.search}>
        <Icon name="search" size={22} color={colors.textSecondary} />
        <TextInput
          value={filters.query}
          onChangeText={(query) => setFilters({ ...filters, query })}
          placeholder={t('map.search')}
          placeholderTextColor={colors.textSecondary}
          style={styles.searchInput}
          accessibilityLabel={t('map.search')}
          returnKeyType="search"
        />
        {filters.query ? (
          <Pressable
            onPress={() => setFilters({ ...filters, query: '' })}
            hitSlop={8}
            accessibilityLabel={t('map.clear')}
          >
            <Icon name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <IconButton
        icon="tune"
        label={t('map.filters')}
        onPress={() => setFiltersOpen(true)}
        onMap
        badge={activeFilterCount(filters)}
      />
    </View>
  );
  const filtersModal = (
    <FiltersSheet
      visible={filtersOpen}
      filters={filters}
      standards={standards}
      count={filterStations(items, filters).length}
      onChange={setFilters}
      onClose={() => setFiltersOpen(false)}
    />
  );

  if (view === 'list' || !hasMap) {
    return (
      <Screen dense padded={false} style={{ paddingTop: insets.top + spacing.md }}>
        <View style={{ paddingHorizontal: spacing.list, gap: spacing.ms }}>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Title>{t('map.stations')}</Title>
            {hasMap ? (
              <IconButton icon="map" label={t('map.mapView')} onPress={() => setView('map')} />
            ) : null}
          </View>
          {search}
        </View>
        {chips}
        <View style={{ paddingHorizontal: spacing.list, gap: spacing.ms }}>
          {offline ? (
            <Notice tone="warning" icon="wifi-off">
              {t('map.offline', { minutes: offlineMinutes })}
            </Notice>
          ) : null}
          {locations.error && !locations.data ? (
            <Notice tone="danger">{errorMessage(locations.error, t('app.offline'))}</Notice>
          ) : null}
          {location.status === 'denied' ? (
            <LocationNotice onEnable={() => void location.request()} />
          ) : null}
          {sorted.length === 0 ? (
            <Muted>{items.length === 0 ? t('map.none') : t('map.noResults')}</Muted>
          ) : null}
          {sorted.map((station) => (
            <StationRow
              key={station.location.id}
              station={station}
              onPress={() => router.push(`/station/${station.location.id}`)}
            />
          ))}
        </View>
        {filtersModal}
      </Screen>
    );
  }

  return (
    <View style={styles.full}>
      <SiteMap
        locations={filtered}
        selectedId={selectedId}
        onSelect={(station) =>
          select(
            sorted.find((s) => s.location.id === station.id) ?? {
              location: station,
              distanceKm: null,
            },
          )
        }
        onDeselect={() => setSelectedId(null)}
        user={location.coords}
        focus={focus}
        webHint={t('map.webHint')}
      />
      <View
        pointerEvents="box-none"
        style={[styles.overlay, { paddingTop: insets.top + spacing.sm }]}
      >
        {search}
        {chips}
        {offline ? (
          <View style={{ paddingHorizontal: spacing.float }}>
            <Notice tone="warning" icon="wifi-off">
              {t('map.offline', { minutes: offlineMinutes })}
            </Notice>
          </View>
        ) : null}
      </View>
      <View
        style={[
          styles.mapButtons,
          {
            // Sobre la hoja plegada (88), la barra de pestañas y el área segura.
            bottom: 88 + size.tabBar + insets.bottom + spacing.float,
          },
        ]}
      >
        <IconButton icon="list" label={t('map.listView')} onPress={() => setView('list')} onMap />
        <IconButton
          icon="my-location"
          label={t('map.myLocation')}
          onPress={() => void locate()}
          onMap
          color={colors.info}
        />
      </View>
      <BottomSheet
        expanded={expanded || Boolean(selected)}
        onToggle={() => (selected ? select(null) : setExpanded((value) => !value))}
      >
        {selected ? (
          <StationSheet
            station={selected}
            onClose={() => select(null)}
            onView={() => router.push(`/station/${selected.location.id}`)}
          />
        ) : (
          <NearbySheet
            stations={sorted}
            freeCount={withFree.length}
            nearest={nearest}
            expanded={expanded}
            locationDenied={location.status === 'denied' || location.status === 'unavailable'}
            onEnableLocation={() => void location.request()}
            onPick={(station) => select(station)}
          />
        )}
      </BottomSheet>
      {filtersModal}
    </View>
  );
}

function StationRow({ station, onPress }: { station: StationWithDistance; onPress: () => void }) {
  const { t, locale } = useI18n();
  const summary = availability(station.location.evses);
  const groups = connectorGroups(station.location.evses, locale);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.stationRow, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Subtitle>{station.location.name}</Subtitle>
        <Muted>
          {[
            station.distanceKm !== null ? formatDistance(station.distanceKm) : null,
            summary.maxPowerKw ? formatKw(summary.maxPowerKw) : null,
            groups.map((g) => `${g.label} · ${g.count}`).join(', '),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Muted>
        <AvailabilityBadge summary={summary} />
      </View>
      <Icon name="chevron-right" size={24} color={colors.handle} />
      <Text style={{ display: 'none' }}>{t('map.title')}</Text>
    </Pressable>
  );
}

function AvailabilityBadge({ summary }: { summary: ReturnType<typeof availability> }) {
  const { t } = useI18n();
  if (summary.noData)
    return <Badge tone="neutral" icon="help-outline" text={t('visual.nodata')} dotted />;
  if (summary.allOut) return <Badge tone="neutral" icon="block" text={t('visual.out')} outlined />;
  if (summary.available === 0)
    return <Badge tone="warning" icon="schedule" text={t('station.noneAvailable')} />;
  return (
    <Badge
      tone="success"
      icon="check"
      text={t('station.availableBadge', { available: summary.available, total: summary.total })}
    />
  );
}

function LocationNotice({ onEnable }: { onEnable: () => void }) {
  const { t } = useI18n();
  return (
    <Notice
      tone="info"
      icon="location-off"
      action={
        <Button title={t('map.enableLocation')} variant="secondary" compact onPress={onEnable} />
      }
    >
      <View style={{ gap: 2 }}>
        <Text style={{ ...text.etiqueta, color: colors.info }}>{t('map.noLocation')}</Text>
        <Muted>{t('map.noLocationHelp')}</Muted>
      </View>
    </Notice>
  );
}

function NearbySheet({
  stations,
  freeCount,
  nearest,
  expanded,
  locationDenied,
  onEnableLocation,
  onPick,
}: {
  stations: StationWithDistance[];
  freeCount: number;
  nearest: StationWithDistance | null;
  expanded: boolean;
  locationDenied: boolean;
  onEnableLocation: () => void;
  onPick: (station: StationWithDistance) => void;
}) {
  const { t } = useI18n();
  const title =
    stations.length === 0
      ? t('map.noResults')
      : freeCount === 0
        ? t('map.nearbyNone')
        : freeCount === 1
          ? t('map.nearbyOne')
          : t('map.nearbyMany', { n: freeCount });
  return (
    <View style={{ flex: 1, gap: spacing.ms }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Subtitle numberOfLines={1}>{title}</Subtitle>
          {nearest ? (
            <Muted numberOfLines={1}>
              {nearest.distanceKm !== null
                ? t('map.nearest', {
                    distance: formatDistance(nearest.distanceKm),
                    name: nearest.location.name,
                  })
                : nearest.location.name}
            </Muted>
          ) : null}
        </View>
        <Icon
          name={expanded ? 'expand-more' : 'expand-less'}
          size={28}
          color={colors.textSecondary}
        />
      </View>
      {expanded ? (
        <ScrollView contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.lg }}>
          {locationDenied ? <LocationNotice onEnable={onEnableLocation} /> : null}
          {stations.map((station) => (
            <StationRow
              key={station.location.id}
              station={station}
              onPress={() => onPick(station)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function StationSheet({
  station,
  onClose,
  onView,
}: {
  station: StationWithDistance;
  onClose: () => void;
  onView: () => void;
}) {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const summary = availability(station.location.evses);
  const groups = connectorGroups(station.location.evses, locale);
  const firstEvse = station.location.evses[0]?.evseId ?? '';
  const quote = useQuery(
    () => auth.api.get<EvseDetail>(`/evses/${encodeURIComponent(firstEvse)}`),
    [firstEvse],
    { enabled: Boolean(firstEvse) },
  );
  const price = quote.data?.tariff?.energy.pricePerKwhNow ?? null;
  const onSite = isOnSite(station.distanceKm);
  const meta = [
    station.distanceKm !== null ? formatDistance(station.distanceKm) : null,
    station.distanceKm !== null
      ? t('map.driveTime', { minutes: driveMinutes(station.distanceKm) })
      : null,
    isOpen24h(station.location.openingHours) ? t('map.open24') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ScrollView contentContainerStyle={{ gap: spacing.ms, paddingBottom: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Heading>{station.location.name}</Heading>
          {meta ? <Muted>{meta}</Muted> : null}
        </View>
        <IconButton
          icon="close"
          label={t('map.closeStation')}
          onPress={onClose}
          style={{ width: 40, height: 40 }}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <MiniTile
          label={t('station.maxPower')}
          value={summary.maxPowerKw ? formatKw(summary.maxPowerKw) : '—'}
        />
        <MiniTile
          label={t('station.availableLabel')}
          value={t('station.availableOf', { available: summary.available, total: summary.total })}
          tone={summary.available > 0 ? colors.success : colors.warning}
        />
        {quote.loading && !quote.data ? (
          <View style={styles.miniTile}>
            <Text style={styles.miniLabel}>{t('station.tariff')}</Text>
            <Skeleton width={72} height={24} />
          </View>
        ) : (
          <MiniTile
            label={t('station.tariff')}
            value={
              price ? formatPerKwh(price, quote.data?.tariff?.currency) : t('station.noTariff')
            }
            small={!price}
          />
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {groups.map((group) => (
          <Chip key={group.standard} icon="ev-station" label={`${group.label} · ${group.count}`} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button
          title={t('station.view')}
          variant="secondary"
          onPress={onView}
          style={{ flex: 1, width: undefined }}
        />
        {onSite ? (
          <Button
            title={t('station.start')}
            icon="bolt"
            onPress={() => router.push(`/station/${station.location.id}`)}
            style={{ flex: 1, width: undefined }}
          />
        ) : (
          <Button
            title={t('station.directions')}
            icon="directions"
            onPress={() => void openDirections(station.location)}
            style={{ flex: 1, width: undefined }}
          />
        )}
      </View>
    </ScrollView>
  );
}

function MiniTile({
  label,
  value,
  tone,
  small = false,
}: {
  label: string;
  value: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <View style={styles.miniTile}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text
        style={[
          styles.miniValue,
          tone ? { color: tone } : null,
          small && { fontSize: 14, lineHeight: 20 },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function FiltersSheet({
  visible,
  filters,
  standards,
  count,
  onChange,
  onClose,
}: {
  visible: boolean;
  filters: StationFilters;
  standards: { standard: string; label: string; count: number }[];
  count: number;
  onChange: (filters: StationFilters) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={t('app.close')}
        />
        <View style={[styles.filters, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.handle} />
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Heading>{t('map.filters')}</Heading>
            <LinkText onPress={() => onChange({ ...NO_FILTERS, query: filters.query })}>
              {t('map.clear')}
            </LinkText>
          </View>
          <Text style={styles.filterLabel}>{t('map.power')}</Text>
          <View style={styles.chipRow}>
            {POWER_STEPS.map((step) => (
              <Chip
                key={step}
                label={step === 0 ? t('map.anyPower') : `${step} kW+`}
                active={filters.minPowerKw === step}
                onPress={() => onChange({ ...filters, minPowerKw: step })}
              />
            ))}
          </View>
          <Text style={styles.filterLabel}>{t('map.connector')}</Text>
          <View style={styles.chipRow}>
            <Chip
              label={t('map.anyConnector')}
              active={filters.standards.length === 0}
              onPress={() => onChange({ ...filters, standards: [] })}
            />
            {standards.map((group) => (
              <Chip
                key={group.standard}
                label={group.label}
                active={filters.standards.includes(group.standard)}
                onPress={() =>
                  onChange({
                    ...filters,
                    standards: filters.standards.includes(group.standard)
                      ? filters.standards.filter((s) => s !== group.standard)
                      : [...filters.standards, group.standard],
                  })
                }
              />
            ))}
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingVertical: spacing.sm,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...text.cuerpo, color: colors.text }}>{t('map.availableNow')}</Text>
              <Muted>{t('map.availableNowHelp')}</Muted>
            </View>
            <Toggle
              value={filters.availableNow}
              onChange={(value) => onChange({ ...filters, availableNow: value })}
              label={t('map.availableNow')}
            />
          </View>
          <Button
            title={count === 1 ? t('map.showOne') : t('map.showMany', { n: count })}
            onPress={onClose}
            disabled={count === 0}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: colors.map.bg },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, gap: spacing.ms },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.float,
    alignItems: 'center',
  },
  search: {
    flex: 1,
    height: size.touch,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 16,
    paddingVertical: 0,
  },
  mapButtons: { position: 'absolute', right: spacing.float, gap: spacing.sm },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.ms,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  miniTile: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.card,
    padding: spacing.ms,
    gap: 4,
    minHeight: 64,
  },
  miniLabel: { ...text.nota, color: colors.textSecondary },
  miniValue: {
    fontFamily: fonts.bodyBold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  filters: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.list,
    paddingTop: 10,
    gap: spacing.ms,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.handle,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  filterLabel: { ...text.etiqueta, color: colors.textSecondary, paddingTop: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
