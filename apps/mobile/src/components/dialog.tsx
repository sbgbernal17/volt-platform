/**
 * Diálogo para acciones críticas (handoff, Dialog): hoja flotante inferior sobre un velo negro al
 * 75 %, título, filas clave-valor, nota y dos botones apilados con el primario arriba.
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens.ts';
import { Button, Heading, Note } from '../theme/ui.tsx';

export function Dialog({
  visible,
  title,
  children,
  note,
  primary,
  secondary,
  onClose,
}: {
  visible: boolean;
  title: string;
  children?: ReactNode;
  note?: string | undefined;
  primary: { title: string; onPress: () => void; loading?: boolean; danger?: boolean };
  secondary?: { title: string; onPress: () => void } | undefined;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <View style={[styles.sheet, { marginBottom: insets.bottom + spacing.xl }]}>
          <Heading>{title}</Heading>
          {children}
          {note ? <Note>{note}</Note> : null}
          <View style={{ gap: spacing.sm, paddingTop: spacing.xs }}>
            <Button
              title={primary.title}
              onPress={primary.onPress}
              loading={primary.loading ?? false}
            />
            {secondary ? (
              <Button title={secondary.title} variant="secondary" onPress={secondary.onPress} />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.dialogScrim, justifyContent: 'flex-end' },
  sheet: {
    marginHorizontal: spacing.float,
    backgroundColor: colors.surface,
    borderRadius: radius.sheet,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
