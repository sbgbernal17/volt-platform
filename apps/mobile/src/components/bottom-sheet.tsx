/**
 * Hoja inferior sobre el mapa (handoff, BottomSheet): fondo #171717, radio superior 20 y asa de
 * 36×4. Dos alturas, colapsada (88) y media (55 %), que se alternan tocando el asa; el arrastre
 * queda para después (ADR 0025).
 */
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, motion, radius, size, spacing } from '../theme/tokens.ts';

export function BottomSheet({
  expanded,
  onToggle,
  collapsedHeight = 88,
  expandedRatio = 0.55,
  children,
  withTabBar = true,
}: {
  expanded: boolean;
  onToggle: () => void;
  collapsedHeight?: number;
  expandedRatio?: number;
  children: ReactNode;
  withTabBar?: boolean;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bottom = withTabBar ? size.tabBar + insets.bottom : insets.bottom;
  const target = expanded ? Math.round(windowHeight * expandedRatio) : collapsedHeight;
  const height = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    Animated.timing(height, {
      toValue: target,
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [target, height]);
  return (
    <Animated.View style={[styles.sheet, { bottom, height }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Contraer' : 'Expandir'}
        hitSlop={12}
        style={styles.handleArea}
      >
        <View style={styles.handle} />
      </Pressable>
      <View style={styles.content}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.list,
    overflow: 'hidden',
  },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.handle },
  content: { flex: 1, gap: spacing.ms },
});
