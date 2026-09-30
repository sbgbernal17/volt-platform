/** Bloques de carga (handoff): fondo #171717 con pulso de opacidad 0,5 → 1. */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, type DimensionValue, StyleSheet } from 'react-native';
import { colors, radius } from '../theme/tokens.ts';

export function Skeleton({
  width = '100%',
  height = 20,
  round = false,
}: {
  width?: DimensionValue;
  height?: number;
  round?: boolean;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
          ]),
        );
        loop.start();
      });
    return () => loop?.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        styles.block,
        { width, height, borderRadius: round ? height / 2 : radius.card, opacity },
      ]}
    />
  );
}

const styles = StyleSheet.create({ block: { backgroundColor: colors.surface } });
