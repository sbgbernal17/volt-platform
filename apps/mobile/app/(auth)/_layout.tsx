import { Stack } from 'expo-router';
import { colors } from '../../src/theme/tokens.ts';

/** Bienvenida, registro, inicio y recuperación: sin barra nativa (cada pantalla trae su fila superior). */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="forgot" />
    </Stack>
  );
}
