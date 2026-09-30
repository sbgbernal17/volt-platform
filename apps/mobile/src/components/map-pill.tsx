/** Marcador píldora nativo (handoff, MapMarker) para react-native-maps: glifo del estado y libres/total. */
import { StyleSheet, Text, View } from 'react-native';
import type { MarkerVisual } from '../lib/google-maps.ts';
import { Icon, type IconName } from '../theme/icon.tsx';
import { colors, fonts } from '../theme/tokens.ts';

const ICONS: Record<MarkerVisual, IconName> = {
  available: 'check',
  occupied: 'schedule',
  out: 'block',
  nodata: 'help-outline',
};

const GLYPH: Record<MarkerVisual, { color: string; soft: string }> = {
  available: { color: colors.success, soft: colors.successSoft },
  occupied: { color: colors.warning, soft: colors.warningSoft },
  out: { color: colors.textSecondary, soft: colors.field },
  nodata: { color: colors.textSecondary, soft: colors.field },
};

export function MapPill({
  visual,
  label,
  selected = false,
  detail,
}: {
  visual: MarkerVisual;
  label: string;
  selected?: boolean;
  detail?: string | undefined;
}) {
  const palette = GLYPH[visual];
  return (
    <View style={[styles.pill, selected && styles.selected]}>
      <View
        style={[
          styles.circle,
          selected ? styles.circleSelected : { backgroundColor: palette.soft },
        ]}
      >
        <Icon name={ICONS[visual]} size={selected ? 20 : 18} color={palette.color} />
      </View>
      <Text style={[styles.text, selected && styles.textSelected]}>
        {selected && detail ? `${detail} · ${label}` : label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingLeft: 4,
    paddingRight: 10,
    borderRadius: 17,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: colors.handle,
  },
  selected: {
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: colors.text,
  },
  circle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleSelected: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.text },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  textSelected: { fontSize: 15 },
});
