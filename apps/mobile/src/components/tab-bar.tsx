/**
 * Barra de pestañas (handoff, TabBar y ChargeTabButton): 84 px sobre negro, cuatro destinos
 * (Mapa · Cargar · Actividad · Cuenta). El botón central es un círculo rojo de 60 px que sube
 * 24 px: sin sesión abre el escáner; con una carga en curso muestra el rayo con el porcentaje y
 * abre la carga en vivo.
 */
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/index.tsx';
import { useActiveSession } from '../session/active-session.tsx';
import { Icon, type IconName } from '../theme/icon.tsx';
import { colors, fonts, size, spacing, text } from '../theme/tokens.ts';

/** Subconjunto de las props de la barra de React Navigation que se usan aquí. */
export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    navigate: (name: string) => void;
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented: boolean;
    };
  };
}

const TABS: {
  name: string;
  icon: IconName;
  label: 'tabs.map' | 'tabs.history' | 'tabs.account';
}[] = [
  { name: 'index', icon: 'map', label: 'tabs.map' },
  { name: 'history', icon: 'receipt-long', label: 'tabs.history' },
  { name: 'account', icon: 'person', label: 'tabs.account' },
];

export function VoltTabBar({ state, navigation }: TabBarProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const active = useActiveSession().session;
  const current = state.routes[state.index]?.name;
  const charging = active?.state === 'ACTIVE';

  const tab = (name: string, icon: IconName, label: string) => {
    const route = state.routes.find((r) => r.name === name);
    const focused = current === name;
    const color = focused ? colors.brand : colors.textSecondary;
    return (
      <Pressable
        key={name}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        onPress={() => {
          if (!route) return;
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(name);
        }}
        style={styles.tab}
      >
        <Icon name={icon} size={24} color={color} />
        <Text style={[styles.label, { color }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[styles.bar, { height: size.tabBar + insets.bottom, paddingBottom: insets.bottom }]}
    >
      {tab(TABS[0]?.name ?? 'index', 'map', t('tabs.map'))}
      <View style={styles.tab}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active ? t('tabs.charging') : t('tabs.scan')}
          onPress={() => router.push(active ? `/session/${active.id}` : '/scan')}
          style={({ pressed }) => [
            styles.charge,
            pressed && { backgroundColor: colors.primaryPressed },
          ]}
        >
          {active ? (
            <View style={{ alignItems: 'center' }}>
              <Icon name="bolt" size={20} color={colors.onPrimary} />
              {charging && active.soc !== null ? (
                <Text style={styles.soc}>{`${Math.round(active.soc)} %`}</Text>
              ) : null}
            </View>
          ) : (
            <Icon name="qr-code-scanner" size={28} color={colors.onPrimary} />
          )}
        </Pressable>
        <Text style={[styles.label, { color: colors.text }]}>
          {active ? t('tabs.charging') : t('tabs.scan')}
        </Text>
      </View>
      {tab('history', 'receipt-long', t('tabs.history'))}
      {tab('account', 'person', t('tabs.account'))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.black,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
    alignItems: 'flex-start',
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: size.touch },
  label: { ...text.tab },
  charge: {
    width: size.chargeButton,
    height: size.chargeButton,
    borderRadius: size.chargeButton / 2,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.bg,
    marginTop: -(spacing.lg + spacing.sm),
    alignItems: 'center',
    justifyContent: 'center',
  },
  soc: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.onPrimary, lineHeight: 15 },
});
