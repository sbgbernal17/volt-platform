/**
 * Componentes base de la app con el sistema del handoff (ADR 0025): tema oscuro plano, botón
 * primario a lo ancho de 52 px con texto en mayúsculas e ícono opcional, tarjetas de 12 px, campos
 * de 52 px con borde blanco, insignias con palabra e ícono. Sin bibliotecas de UI de terceros.
 */
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  type PressableProps,
  Text as RNText,
  ScrollView,
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './icon.tsx';
import {
  colors,
  fonts,
  radius,
  size,
  spacing,
  type Tone,
  text as textStyles,
  toneColors,
} from './tokens.ts';

export function Screen({
  children,
  scroll = true,
  padded = true,
  dense = false,
  style,
  bottom,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Márgenes de lista (20) en lugar de los de formulario (30). */
  dense?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Barra fija al pie (botón primario) por fuera del desplazamiento. */
  bottom?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const inner: ViewStyle = {
    paddingHorizontal: padded ? (dense ? spacing.list : spacing.xl) : 0,
    paddingTop: padded ? spacing.md : 0,
    paddingBottom: bottom ? spacing.md : insets.bottom + spacing.lg,
    gap: spacing.md,
  };
  const content = scroll ? (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[inner, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screen, inner, style]}>{children}</View>
  );
  if (!bottom) return content;
  return (
    <View style={styles.screen}>
      {content}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: insets.bottom + spacing.md,
            paddingHorizontal: dense ? spacing.list : spacing.xl,
          },
        ]}
      >
        {bottom}
      </View>
    </View>
  );
}

// ---- Texto ----

export function Title({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.title, style]} />;
}

export function Heading({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.heading, style]} />;
}

export function Display({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.display, style]} />;
}

export function Subtitle({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.subtitle, style]} />;
}

export function Body({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.body, style]} />;
}

export function Muted({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.muted, style]} />;
}

export function Note({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.note, style]} />;
}

export function Label({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.label, style]} />;
}

export function Big({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.big, style]} />;
}

export function LinkText({
  onPress,
  children,
  style,
}: {
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={8}>
      <RNText style={[styles.link, style]}>{children}</RNText>
    </Pressable>
  );
}

// ---- Botones ----

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  compact = false,
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  title: string;
  variant?: ButtonVariant;
  icon?: IconName | undefined;
  loading?: boolean;
  disabled?: boolean;
  /** Alto de 44 (enlaces de acción). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const foreground =
    variant === 'ghost'
      ? colors.link
      : variant === 'danger'
        ? colors.danger
        : inactive && variant === 'primary'
          ? colors.textMuted
          : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        compact && { minHeight: 44 },
        variant === 'primary' && {
          backgroundColor: inactive
            ? colors.field
            : pressed
              ? colors.primaryPressed
              : colors.primary,
        },
        variant === 'secondary' && [
          styles.buttonSecondary,
          pressed && { backgroundColor: colors.surface },
          inactive && { borderColor: colors.borderSoft },
        ],
        variant === 'ghost' && [
          { backgroundColor: 'transparent', minHeight: 44 },
          pressed && { opacity: 0.7 },
        ],
        variant === 'danger' && [
          styles.buttonSecondary,
          { borderColor: colors.danger },
          pressed && { backgroundColor: colors.dangerSoft },
        ],
        inactive && variant !== 'primary' && { opacity: 0.5 },
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onPrimary : colors.text} />
      ) : (
        <View style={styles.buttonContent}>
          {icon ? <Icon name={icon} size={22} color={foreground} /> : null}
          <RNText style={[styles.buttonText, { color: foreground }]} numberOfLines={1}>
            {title.toUpperCase()}
          </RNText>
        </View>
      )}
    </Pressable>
  );
}

/** Botón redondo de 48 con ícono; sobre el mapa lleva borde suave. */
export function IconButton({
  icon,
  label,
  onPress,
  onMap = false,
  color = colors.text,
  style,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  onMap?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
  /** Contador rojo (filtros activos, avisos sin leer). */
  badge?: number | undefined;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        onMap && { borderWidth: 1, borderColor: colors.borderSoft },
        pressed && { backgroundColor: colors.field },
        style,
      ]}
    >
      <Icon name={icon} size={24} color={color} />
      {badge ? (
        <View style={styles.counter}>
          <RNText style={styles.counterText}>{badge > 9 ? '9+' : String(badge)}</RNText>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Chip de filtro (36 px, área táctil 48). Activo: fondo blanco y texto negro con check. */
export function Chip({
  label,
  active = false,
  icon,
  onPress,
}: {
  label: string;
  active?: boolean;
  icon?: IconName | undefined;
  onPress?: (() => void) | undefined;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: colors.text, borderColor: colors.text },
        pressed && !active && { backgroundColor: colors.field },
      ]}
    >
      {active ? (
        <Icon name="check" size={18} color={colors.black} />
      ) : icon ? (
        <Icon name={icon} size={18} color={colors.text} />
      ) : null}
      <RNText style={[styles.chipText, active && { color: colors.black }]}>{label}</RNText>
    </Pressable>
  );
}

// ---- Contenedores ----

export function Card({
  children,
  style,
  onPress,
  selected = false,
  dimmed = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: (() => void) | undefined;
  selected?: boolean;
  dimmed?: boolean;
}) {
  const extra = [
    selected && { borderWidth: 2, borderColor: colors.brand },
    dimmed && { opacity: 0.55 },
    style,
  ];
  if (onPress && !dimmed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && { borderColor: colors.handle }, extra]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, extra]}>{children}</View>;
}

export function Row({
  children,
  style,
  between = false,
  wrap = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  between?: boolean;
  wrap?: boolean;
}) {
  return (
    <View
      style={[
        styles.row,
        !wrap && { flexWrap: 'nowrap' },
        between && { justifyContent: 'space-between' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Spacer({ size: height = spacing.md }: { size?: number }) {
  return <View style={{ height }} />;
}

// ---- Formularios ----

export function Field({
  label,
  error,
  help,
  style,
  secureTextEntry,
  prefix,
  suffix,
  containerStyle,
  ...props
}: TextInputProps & {
  label: string;
  error?: string | null | undefined;
  help?: string | undefined;
  /** Prefijo fijo a la izquierda (p. ej. +57). */
  prefix?: string | undefined;
  /** Elemento a la derecha dentro del campo (p. ej. el chulo de verificado). */
  suffix?: ReactNode;
  /** Estilo del contenedor (p. ej. `flex: 1` para dos campos en una fila). */
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(Boolean(secureTextEntry));
  const border = error ? colors.danger : colors.control;
  return (
    <View style={[{ gap: spacing.sm }, containerStyle]}>
      <RNText style={styles.fieldLabel}>{label}</RNText>
      <View style={[styles.inputWrap, { borderColor: border }, focused && styles.inputFocused]}>
        {prefix ? (
          <>
            <RNText style={styles.prefix}>{prefix}</RNText>
            <View style={styles.prefixDivider} />
          </>
        ) : null}
        <TextInput
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, style]}
          accessibilityLabel={label}
          secureTextEntry={hidden}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Mostrar' : 'Ocultar'}
            onPress={() => setHidden((value) => !value)}
            hitSlop={8}
            style={{ paddingHorizontal: spacing.ms }}
          >
            <Icon
              name={hidden ? 'visibility' : 'visibility-off'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
        {suffix ? <View style={{ paddingRight: spacing.ms }}>{suffix}</View> : null}
      </View>
      {error ? (
        <RNText style={styles.error}>{error}</RNText>
      ) : help ? (
        <RNText style={styles.note}>{help}</RNText>
      ) : null}
    </View>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={styles.checkboxRow}
    >
      <View
        style={[
          styles.checkbox,
          checked && { backgroundColor: colors.primary, borderColor: colors.primary },
        ]}
      >
        {checked ? <Icon name="check" size={18} color={colors.onPrimary} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[styles.toggle, value && { backgroundColor: colors.success }]}
    >
      <View style={[styles.toggleKnob, value && { alignSelf: 'flex-end' }]} />
    </Pressable>
  );
}

// ---- Estados ----

export function Badge({
  tone = 'neutral',
  text: label,
  icon,
  outlined = false,
  dotted = false,
}: {
  tone?: Tone;
  text: string;
  icon?: IconName | undefined;
  outlined?: boolean;
  dotted?: boolean;
}) {
  const palette = toneColors[tone];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: palette.bg },
        outlined && {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.borderSoft,
        },
        dotted && {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderStyle: 'dotted',
          borderColor: colors.textMuted,
        },
        !icon && { paddingLeft: 10 },
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={palette.fg} /> : null}
      <RNText style={[styles.badgeText, { color: palette.fg }]}>{label}</RNText>
    </View>
  );
}

/** Aviso en línea con ícono: info azul, aviso ámbar, error rojo suave, éxito verde. */
export function Notice({
  tone = 'info',
  icon,
  children,
  action,
}: {
  tone?: Tone;
  icon?: IconName | undefined;
  children: ReactNode;
  action?: ReactNode;
}) {
  const palette = toneColors[tone];
  const defaultIcon: IconName =
    tone === 'success'
      ? 'check-circle'
      : tone === 'warning'
        ? 'warning'
        : tone === 'danger'
          ? 'error'
          : 'info';
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]}>
      <Icon name={icon ?? defaultIcon} size={22} color={palette.fg} />
      <View style={{ flex: 1, gap: spacing.sm }}>
        {typeof children === 'string' ? (
          <RNText style={[styles.noticeText, { color: palette.fg }]}>{children}</RNText>
        ) : (
          children
        )}
        {action}
      </View>
    </View>
  );
}

export function KeyValue({
  label,
  value,
  big = false,
  style,
}: {
  label: string;
  value: string;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: 2, minWidth: 96 }, style]}>
      <Muted>{label}</Muted>
      {big ? <Big>{value}</Big> : <Body style={{ fontFamily: fonts.bodyMedium }}>{value}</Body>}
    </View>
  );
}

/** Fila clave-valor de una lista de datos (recibo, resumen): etiqueta gris y valor a la derecha. */
export function DataRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.dataRow}>
      <RNText style={styles.dataLabel}>{label}</RNText>
      <RNText style={[styles.dataValue, strong && { fontFamily: fonts.bodyBold }]}>{value}</RNText>
    </View>
  );
}

/** Tile de dato en vivo: etiqueta gris + cifra tabular + unidad. */
export function MetricTile({
  label,
  value,
  unit,
  stale = false,
  style,
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  stale?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.tile, style]}>
      <RNText style={styles.tileLabel}>{label}</RNText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <RNText style={[styles.tileValue, stale && { color: colors.textMuted }]}>{value}</RNText>
        {unit ? <RNText style={styles.tileUnit}>{unit}</RNText> : null}
      </View>
    </View>
  );
}

/** Fila de lista de 56 px: ícono (o círculo con fondo suave), título, subtítulo y chevron. */
export function ListRow({
  icon,
  iconTone,
  title,
  subtitle,
  onPress,
  trailing,
  destructive = false,
  badge,
}: {
  icon?: IconName | undefined;
  /** Con tono, el ícono va en un círculo de 40 con fondo suave. */
  iconTone?: Tone | undefined;
  title: string;
  subtitle?: string | undefined;
  onPress?: (() => void) | undefined;
  trailing?: ReactNode;
  destructive?: boolean;
  badge?: string | undefined;
}) {
  const color = destructive
    ? colors.brand
    : iconTone
      ? toneColors[iconTone].fg
      : colors.textSecondary;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.7 }]}
    >
      {icon ? (
        iconTone ? (
          <View style={[styles.iconCircle, { backgroundColor: toneColors[iconTone].bg }]}>
            <Icon name={icon} size={22} color={color} />
          </View>
        ) : (
          <Icon name={icon} size={22} color={color} />
        )
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <RNText style={[styles.body, destructive && { color: colors.brand }]}>{title}</RNText>
        {subtitle ? <RNText style={styles.muted}>{subtitle}</RNText> : null}
      </View>
      {badge ? <Badge tone="danger" text={badge} /> : null}
      {trailing ?? (onPress ? <Icon name="chevron-right" size={24} color={colors.handle} /> : null)}
    </Pressable>
  );
}

/**
 * Pantalla de carga: el rayo de la marca en un anillo que late (escala y opacidad) y el texto
 * debajo; con "Reducir movimiento" el anillo queda fijo. Ocupa el espacio disponible y centra.
 */
export function Loading({ text: label }: { text?: string | undefined }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, {
              toValue: 1,
              duration: 700,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(pulse, {
              toValue: 0,
              duration: 700,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        );
        loop.start();
      });
    return () => loop?.stop();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] });
  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  return (
    <View style={[styles.center, styles.loading]} accessibilityRole="progressbar">
      <View style={styles.loadingMark}>
        <Animated.View
          style={[styles.loadingHalo, { opacity: haloOpacity, transform: [{ scale: haloScale }] }]}
        />
        <Animated.View style={[styles.loadingRing, { transform: [{ scale }] }]}>
          <Icon name="bolt" size={36} color={colors.brand} />
        </Animated.View>
      </View>
      {label ? <Muted>{label}</Muted> : null}
    </View>
  );
}

export function ErrorBox({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Notice tone="danger">{message}</Notice>
      {onRetry ? (
        <Button title={retryLabel ?? 'Reintentar'} variant="secondary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

/** Estado vacío: círculo con ícono, título, texto y acción. */
export function EmptyState({
  icon = 'bolt',
  title,
  text: label,
  action,
}: {
  icon?: IconName;
  title: string;
  text?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <View style={[styles.center, { paddingVertical: spacing.section }]}>
      <View style={styles.emptyCircle}>
        <Icon name={icon} size={36} color={colors.textSecondary} />
      </View>
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      {label ? (
        <Body style={{ textAlign: 'center', color: colors.textSecondary }}>{label}</Body>
      ) : null}
      {action ? (
        <View style={{ alignSelf: 'stretch', paddingTop: spacing.sm }}>{action}</View>
      ) : null}
    </View>
  );
}

export function Empty({ text: label }: { text: string }) {
  return <EmptyState title={label} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bottomBar: {
    paddingTop: spacing.ms,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  display: { ...textStyles.titularL, color: colors.text },
  title: { ...textStyles.titulo1, color: colors.text },
  heading: { ...textStyles.titulo2, color: colors.text },
  subtitle: { ...textStyles.titulo3, color: colors.text },
  body: { ...textStyles.cuerpo, color: colors.text },
  muted: { ...textStyles.cuerpoS, color: colors.textSecondary },
  note: { ...textStyles.nota, color: colors.textSecondary },
  label: { ...textStyles.etiqueta, color: colors.textSecondary },
  big: { ...textStyles.dato, color: colors.text },
  link: { ...textStyles.etiqueta, fontSize: 16, lineHeight: 24, color: colors.link },
  button: {
    minHeight: size.button,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    width: '100%',
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.control },
  buttonText: { ...textStyles.boton, color: colors.onPrimary },
  iconButton: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.onPrimary },
  chip: {
    height: size.chip,
    borderRadius: radius.circle,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: { ...textStyles.etiqueta, color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  divider: { height: 1, backgroundColor: colors.line },
  fieldLabel: { ...textStyles.etiqueta, color: colors.text },
  inputWrap: {
    minHeight: size.button,
    borderRadius: radius.control,
    borderWidth: 1,
    backgroundColor: colors.field,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Anillo de foco del handoff: 2 px blancos separados 2 px del borde (outline en web y Fabric).
  inputFocused: {
    borderColor: colors.focus,
    outlineWidth: 2,
    outlineOffset: 2,
    outlineColor: colors.focus,
    outlineStyle: 'solid',
  },
  input: {
    flex: 1,
    minHeight: size.button - 2,
    color: colors.text,
    // El anillo de foco lo dibuja el contenedor; se apaga el del navegador (naranja en Android).
    outlineWidth: 0,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  prefix: { ...textStyles.cuerpo, color: colors.textSecondary, paddingLeft: 14 },
  prefixDivider: { width: 1, height: 24, backgroundColor: colors.handle, marginLeft: 10 },
  error: { ...textStyles.nota, color: colors.danger },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.ms },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.borderSoft,
    padding: 3,
    justifyContent: 'center',
  },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.text },
  badge: {
    alignSelf: 'flex-start',
    height: size.badge,
    borderRadius: radius.circle,
    paddingLeft: 6,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 16 },
  notice: {
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.ms,
  },
  noticeText: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 21 },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  dataLabel: { ...textStyles.cuerpoS, color: colors.textSecondary },
  dataValue: { ...textStyles.cuerpo, color: colors.text, textAlign: 'right', flexShrink: 1 },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 6,
    flex: 1,
    minWidth: 140,
  },
  tileLabel: { ...textStyles.etiqueta, color: colors.textSecondary },
  tileValue: { ...textStyles.dato, color: colors.text },
  tileUnit: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.textSecondary },
  listRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.ms,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.ms },
  loading: { flex: 1, minHeight: 200, backgroundColor: colors.bg, gap: spacing.ml },
  loadingMark: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  loadingHalo: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brand,
  },
  loadingRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: colors.brand,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});

/** Fila superior de las pantallas sin barra nativa: volver (48), título centrado y acciones. */
export function TopBar({
  onBack,
  backLabel,
  title,
  subtitle,
  right,
  backIcon = 'arrow-back',
}: {
  onBack?: (() => void) | undefined;
  backLabel: string;
  title?: string | undefined;
  subtitle?: string | undefined;
  right?: ReactNode;
  backIcon?: IconName;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[topBarStyles.bar, { paddingTop: insets.top + spacing.ms }]}>
      <View style={topBarStyles.side}>
        {onBack ? <IconButton icon={backIcon} label={backLabel} onPress={onBack} /> : null}
      </View>
      <View style={topBarStyles.middle}>
        {title ? (
          <RNText style={topBarStyles.title} numberOfLines={1}>
            {title}
          </RNText>
        ) : null}
        {subtitle ? (
          <RNText style={topBarStyles.subtitle} numberOfLines={1}>
            {subtitle}
          </RNText>
        ) : null}
      </View>
      <View style={[topBarStyles.side, { justifyContent: 'flex-end' }]}>{right}</View>
    </View>
  );
}

const topBarStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.list,
    paddingBottom: spacing.ms,
    gap: spacing.sm,
  },
  side: { minWidth: size.iconButton, flexDirection: 'row', gap: spacing.sm },
  middle: { flex: 1, alignItems: 'center', gap: 2 },
  title: { ...textStyles.titulo3, color: colors.text, textAlign: 'center' },
  subtitle: { ...textStyles.cuerpoS, color: colors.textSecondary, textAlign: 'center' },
});
