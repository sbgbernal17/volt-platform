import { Stack } from 'expo-router';
import { useI18n } from '../../src/i18n/index.tsx';
import { colors, fonts } from '../../src/theme/tokens.ts';

export default function AuthLayout() {
  const { t } = useI18n();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.titleMedium, fontSize: 20 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ title: t('auth.signUp') }} />
      <Stack.Screen name="forgot" options={{ title: t('auth.forgotTitle') }} />
    </Stack>
  );
}
