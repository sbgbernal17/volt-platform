/**
 * Componentes de interfaz de la app con la marca VOLT: tema oscuro, botón primario a lo ancho de
 * 52 px con texto en mayúsculas, tarjetas de 12 px, campos con borde blanco de 1 px, estados con
 * palabra y color. Sin bibliotecas de UI de terceros.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { colors, fonts, radius, spacing, type Tone, toneColors } from './tokens.ts';

export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const inner: ViewStyle = {
    paddingHorizontal: padded ? spacing.xl : 0,
    paddingTop: padded ? spacing.md : 0,
    paddingBottom: insets.bottom + spacing.lg,
    gap: spacing.md,
  };
  if (!scroll) return <View style={[styles.screen, inner, style]}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[inner, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Title({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.title, style]} />;
}

export function Heading({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.heading, style]} />;
}

export function Body({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.body, style]} />;
}

export function Muted({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.muted, style]} />;
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

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && {
          backgroundColor: pressed ? colors.primaryPressed : colors.primary,
        },
        variant === 'secondary' && [
          styles.buttonSecondary,
          pressed && { backgroundColor: colors.field },
        ],
        variant === 'ghost' && { backgroundColor: 'transparent' },
        variant === 'danger' && [styles.buttonSecondary, { borderColor: colors.danger }],
        inactive && { opacity: 0.5 },
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onPrimary : colors.text} />
      ) : (
        <RNText
          style={[
            styles.buttonText,
            variant === 'ghost' && { color: colors.link },
            variant === 'danger' && { color: colors.danger },
          ]}
        >
          {title.toUpperCase()}
        </RNText>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: (() => void) | undefined;
}) {
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          pressed && { borderColor: colors.textSecondary },
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({
  label,
  error,
  help,
  style,
  ...props
}: TextInputProps & {
  label: string;
  error?: string | null | undefined;
  help?: string | undefined;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor={colors.textSecondary}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        accessibilityLabel={label}
        {...props}
      />
      {error ? <RNText style={styles.error}>{error}</RNText> : help ? <Muted>{help}</Muted> : null}
    </View>
  );
}

export function Badge({ tone = 'neutral', text }: { tone?: Tone; text: string }) {
  const palette = toneColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <RNText style={[styles.badgeText, { color: palette.fg }]}>{text}</RNText>
    </View>
  );
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const palette = toneColors[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.fg }]}>
      <RNText style={[styles.body, { color: palette.fg }]}>{children}</RNText>
    </View>
  );
}

export function Row({
  children,
  style,
  between = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  between?: boolean;
}) {
  return (
    <View style={[styles.row, between && { justifyContent: 'space-between' }, style]}>
      {children}
    </View>
  );
}

export function KeyValue({
  label,
  value,
  big = false,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <View style={{ gap: 2, minWidth: 96 }}>
      <Muted>{label}</Muted>
      {big ? <Big>{value}</Big> : <Body style={{ fontFamily: fonts.bodyMedium }}>{value}</Body>}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Loading({ text }: { text?: string | undefined }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.brand} size="large" />
      {text ? <Muted>{text}</Muted> : null}
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

export function Empty({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Muted style={{ textAlign: 'center' }}>{text}</Muted>
    </View>
  );
}

export function Spacer({ size = spacing.md }: { size?: number }) {
  return <View style={{ height: size }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { fontFamily: fonts.title, fontSize: 28, lineHeight: 34, color: colors.text },
  heading: { fontFamily: fonts.titleMedium, fontSize: 20, lineHeight: 26, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.text },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  big: { fontFamily: fonts.title, fontSize: 24, lineHeight: 30, color: colors.text },
  link: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 22, color: colors.link },
  button: {
    minHeight: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    width: '100%',
  },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.control },
  buttonText: {
    fontFamily: fonts.titleMedium,
    fontSize: 16,
    letterSpacing: 1,
    color: colors.onPrimary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  input: {
    minHeight: 48,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.field,
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 12, letterSpacing: 0.3 },
  notice: { borderRadius: radius.control, borderWidth: 1, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  divider: { height: 1, backgroundColor: colors.line },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
});
