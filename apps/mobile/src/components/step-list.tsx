/** Lista de pasos (handoff, StepList): hecho, actual, pendiente o con error. */
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../theme/icon.tsx';
import { colors, fonts, spacing, text } from '../theme/tokens.ts';

export type StepState = 'done' | 'current' | 'pending' | 'error';

export interface Step {
  label: string;
  state: StepState;
  detail?: string | undefined;
}

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <View style={{ gap: spacing.md }}>
      {steps.map((step, index) => (
        <View key={step.label} style={styles.row}>
          <View
            style={[
              styles.circle,
              step.state === 'done' && { backgroundColor: colors.successSoft },
              step.state === 'current' && { backgroundColor: colors.brand },
              step.state === 'pending' && { borderWidth: 1, borderColor: colors.handle },
              step.state === 'error' && { backgroundColor: colors.surface },
            ]}
          >
            {step.state === 'done' ? (
              <Icon name="check" size={18} color={colors.success} />
            ) : step.state === 'error' ? (
              <Icon name="close" size={18} color={colors.danger} />
            ) : (
              <Text
                style={[
                  styles.number,
                  step.state === 'current'
                    ? { color: colors.onPrimary }
                    : { color: colors.textSecondary },
                ]}
              >
                {index + 1}
              </Text>
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={[
                styles.label,
                step.state === 'done' && { color: colors.textSecondary },
                step.state === 'pending' && { color: colors.textSecondary },
                step.state === 'error' && { color: colors.danger },
              ]}
            >
              {step.label}
            </Text>
            {step.detail ? <Text style={styles.detail}>{step.detail}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.ms },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { fontFamily: fonts.bodyBold, fontSize: 14 },
  label: { ...text.cuerpo, color: colors.text, paddingTop: 4 },
  detail: { ...text.cuerpoS, color: colors.textSecondary },
});
