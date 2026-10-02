/**
 * Sello "Pagos procesados por Wompi" para las pantallas de medios de pago: candado, texto y la
 * marca denominativa. Cuando el dueño entregue el logotipo oficial, reemplaza el texto por la
 * imagen (`assets/wompi.png`) sin cambiar las pantallas.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n/index.tsx';
import { Icon } from '../theme/icon.tsx';
import { colors, fonts, radius, spacing, text } from '../theme/tokens.ts';

export function WompiMark({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <View style={[styles.row, compact && styles.compact]} accessibilityLabel="Wompi">
      <Icon name="lock" size={compact ? 16 : 18} color={colors.success} />
      <Text style={styles.label}>{t('payment.processedBy')}</Text>
      <View style={styles.badge}>
        <Text style={styles.wordmark}>wompi</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  compact: { justifyContent: 'flex-start', paddingVertical: 0 },
  label: { ...text.cuerpoS, color: colors.textSecondary },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.control,
    backgroundColor: colors.text,
  },
  wordmark: {
    fontFamily: fonts.titleHeavy,
    fontSize: 16,
    lineHeight: 20,
    color: colors.black,
    letterSpacing: -0.3,
  },
});
