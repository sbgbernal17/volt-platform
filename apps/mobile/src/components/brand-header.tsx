/** Cabecera con el degradado de marca (rojo-acción → rojo-profundo → superficie) y el logotipo. */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { headerGradient, spacing } from '../theme/tokens.ts';

export function BrandHeader({
  children,
  compact = false,
}: {
  children?: ReactNode;
  compact?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[...headerGradient]}
      style={[
        styles.header,
        { paddingTop: insets.top + spacing.md, minHeight: compact ? 96 : 180 },
      ]}
    >
      <Image
        source={require('../../assets/logo-blanco.png')}
        style={compact ? styles.logoSmall : styles.logo}
        accessibilityLabel="VOLT"
        resizeMode="contain"
      />
      {children ? <View style={{ gap: spacing.sm }}>{children}</View> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  logo: { width: 160, height: 68 },
  logoSmall: { width: 120, height: 51 },
});
