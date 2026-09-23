import { MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useI18n } from '../../src/i18n/index.tsx';
import { colors, fonts } from '../../src/theme/tokens.ts';

type IconName = keyof typeof MaterialIcons.glyphMap;

export default function TabsLayout() {
  const { t } = useI18n();
  const icon =
    (name: IconName) =>
    ({ color, size }: { color: ColorValue; size: number }) => (
      <MaterialIcons name={name} color={color} size={size} />
    );
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.titleMedium, fontSize: 20 },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.black, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('map.title'), tabBarLabel: t('tabs.map'), tabBarIcon: icon('map') }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: t('scan.title'),
          tabBarLabel: t('tabs.scan'),
          tabBarIcon: icon('qr-code-scanner'),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('history.title'),
          tabBarLabel: t('tabs.history'),
          tabBarIcon: icon('history'),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('account.title'),
          tabBarLabel: t('tabs.account'),
          tabBarIcon: icon('person'),
        }}
      />
    </Tabs>
  );
}
