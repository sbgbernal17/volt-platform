/** Mapa y lista de sedes con estado en vivo (sondeo cada 15 s). */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Location } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
// Sin extensión: Metro elige site-map.native.tsx o site-map.web.tsx según la plataforma.
import { SiteMap } from '../../src/components/site-map';
import { useI18n } from '../../src/i18n/index.tsx';
import { formatKw } from '../../src/lib/format.ts';
import { colors, connectorTone, spacing } from '../../src/theme/tokens.ts';
import {
  Badge,
  Body,
  Button,
  Card,
  Empty,
  ErrorBox,
  Heading,
  Loading,
  Muted,
  Row,
  Screen,
} from '../../src/theme/ui.tsx';

export default function MapScreen() {
  const { t, td } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [view, setView] = useState<'map' | 'list'>(Platform.OS === 'web' ? 'list' : 'map');
  const [selected, setSelected] = useState<string | null>(null);
  const locations = useQuery(() => auth.api.get<{ items: Location[] }>('/locations'), [], {
    intervalMs: 15_000,
  });
  const items = locations.data?.items ?? [];
  const totals = useMemo(() => {
    const all = items.flatMap((l) => l.evses);
    return { available: all.filter((e) => e.status === 'Available').length, total: all.length };
  }, [items]);
  const shown = selected ? items.filter((l) => l.id === selected) : items;

  if (locations.loading && !locations.data) return <Loading text={t('app.loading')} />;
  return (
    <Screen>
      {locations.error && !locations.data ? (
        <ErrorBox
          message={errorMessage(locations.error, t('app.offline'))}
          onRetry={() => void locations.reload()}
          retryLabel={t('app.retry')}
        />
      ) : null}
      <Row between>
        <Muted>
          {t('map.available')}: {totals.available} {t('map.of')} {totals.total}
        </Muted>
        {Platform.OS !== 'web' ? (
          <Row>
            <Button
              title={t('map.map')}
              variant={view === 'map' ? 'primary' : 'ghost'}
              style={{ width: 96, minHeight: 36 }}
              onPress={() => setView('map')}
            />
            <Button
              title={t('map.list')}
              variant={view === 'list' ? 'primary' : 'ghost'}
              style={{ width: 96, minHeight: 36 }}
              onPress={() => setView('list')}
            />
          </Row>
        ) : null}
      </Row>
      {view === 'map' ? (
        <SiteMap
          locations={items}
          webHint={t('map.webHint')}
          onSelect={(location) => {
            setSelected(location.id);
            setView('list');
          }}
        />
      ) : null}
      {selected ? (
        <Pressable onPress={() => setSelected(null)} accessibilityRole="button">
          <Muted>{`← ${t('map.title')}`}</Muted>
        </Pressable>
      ) : null}
      {items.length === 0 && !locations.error ? <Empty text={t('map.none')} /> : null}
      {shown.map((location) => (
        <Card key={location.id}>
          <Heading>{location.name}</Heading>
          <Muted>{[location.address, location.city].filter(Boolean).join(', ')}</Muted>
          <View style={{ gap: spacing.sm }}>
            {location.evses.map((evse) => (
              <Pressable
                key={evse.evseId}
                accessibilityRole="button"
                onPress={() => router.push(`/evse/${encodeURIComponent(evse.evseId)}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: spacing.sm,
                  borderTopWidth: 1,
                  borderTopColor: colors.line,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flex: 1 }}>
                  <Body>{evse.evseId}</Body>
                  <Muted>
                    {evse.standard
                      .replace('IEC_62196_T2_COMBO', 'CCS2')
                      .replace('IEC_62196_T1_COMBO', 'CCS1')
                      .replace('IEC_62196_T2', 'Tipo 2')
                      .replace('GBT_DC', 'GB/T')}{' '}
                    · {formatKw(evse.maxPowerKw)}
                  </Muted>
                </View>
                <Badge tone={connectorTone(evse.status)} text={td(`status.${evse.status}`)} />
              </Pressable>
            ))}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
