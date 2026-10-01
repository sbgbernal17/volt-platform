/**
 * Página de retorno del pago de un cobro pendiente (pública): Wompi devuelve aquí con `id` de la
 * transacción; el checkout emulado de dev con `resultado` (aprobado o rechazado). La confirmación
 * real llega por webhook, así que la pantalla solo orienta y lleva a Transacciones.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { spacing } from '../../src/theme/tokens.ts';
import { Body, Button, Muted, Notice, Screen, Title } from '../../src/theme/ui.tsx';

type Outcome = 'approved' | 'declined' | 'pending';

export default function PaymentReturn() {
  const { t } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ resultado?: string; referencia?: string; id?: string }>();
  const outcome: Outcome =
    params.resultado === 'aprobado'
      ? 'approved'
      : params.resultado === 'rechazado'
        ? 'declined'
        : 'pending';
  const reference = params.referencia ?? params.id ?? null;
  const signedIn = auth.status === 'authenticated';

  return (
    <Screen>
      <Title>{t(`payReturn.${outcome}`)}</Title>
      <Body>{t(`payReturn.${outcome}Body`)}</Body>
      {reference ? <Muted>{t('payReturn.reference', { ref: reference })}</Muted> : null}
      {outcome === 'declined' ? <Notice tone="warning">{t('payReturn.retry')}</Notice> : null}
      <View style={{ gap: spacing.sm }}>
        <Button
          title={signedIn ? t('payReturn.go') : t('payReturn.home')}
          onPress={() => router.replace(signedIn ? '/debts' : '/')}
        />
      </View>
    </Screen>
  );
}
