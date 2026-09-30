/**
 * Anillo de progreso de la carga (handoff, ChargeRing): 248 px, trazo 14, pista #262626 y progreso
 * rojo VOLT que arranca a las 12. Dibujado solo con vistas (dos medias lunas recortadas), sin SVG.
 * Con "Reducir movimiento" el avance no se anima.
 */
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, motion } from '../theme/tokens.ts';

export function ChargeRing({
  progress,
  size = 248,
  stroke = 14,
  color = colors.brand,
  stale = false,
  children,
}: {
  /** 0 a 1; null muestra solo la pista. */
  progress: number | null;
  size?: number;
  stroke?: number;
  color?: string;
  stale?: boolean;
  children?: ReactNode;
}) {
  const value = useRef(new Animated.Value(clamp(progress ?? 0))).current;
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        const target = clamp(progress ?? 0);
        if (reduce) value.setValue(target);
        else
          Animated.timing(value, {
            toValue: target,
            duration: motion.slow,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }).start();
      });
    return () => {
      cancelled = true;
    };
  }, [progress, value]);
  const tone = stale ? colors.ringStale : color;
  const half = size / 2;
  const ring = {
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: stroke,
  };
  // Media luna: solo los bordes superior y derecho llevan color; girada 45° cubre de las 12 a las 6.
  const rightRotation = value.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-135deg', '45deg', '45deg'],
  });
  const leftRotation = value.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['45deg', '45deg', '225deg'],
  });
  return (
    <View style={{ width: size, height: size }} accessibilityRole="progressbar">
      <View style={[styles.absolute, ring, { borderColor: colors.ringTrack }]} />
      <View
        style={[styles.absolute, { left: half, width: half, height: size, overflow: 'hidden' }]}
      >
        <Animated.View
          style={[
            ring,
            styles.arc,
            { marginLeft: -half, borderTopColor: tone, borderRightColor: tone },
            { transform: [{ rotate: rightRotation }] },
          ]}
        />
      </View>
      <View style={[styles.absolute, { left: 0, width: half, height: size, overflow: 'hidden' }]}>
        <Animated.View
          style={[
            ring,
            styles.arc,
            { borderTopColor: tone, borderRightColor: tone },
            { transform: [{ rotate: leftRotation }] },
          ]}
        />
      </View>
      <View style={[styles.absolute, styles.center, { width: size, height: size }]}>
        {children}
      </View>
    </View>
  );
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute', top: 0 },
  arc: { borderColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
