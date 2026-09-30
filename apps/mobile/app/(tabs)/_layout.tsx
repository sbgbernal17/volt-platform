import { Tabs } from 'expo-router';
import { VoltTabBar } from '../../src/components/tab-bar.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { colors } from '../../src/theme/tokens.ts';

/** Pestañas Mapa · Cargar · Cuenta con la barra propia (el botón Cargar no es una ruta; la actividad está en Cuenta). */
export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      tabBar={(props) => <VoltTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: t('map.title') }} />
      <Tabs.Screen name="account" options={{ title: t('account.title') }} />
    </Tabs>
  );
}
