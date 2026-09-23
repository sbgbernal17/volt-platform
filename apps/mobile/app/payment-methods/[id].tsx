/** Medio de pago en verificación (3DS): reto del banco en un WebView y sondeo hasta el resultado. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { PaymentMethod } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { colors } from '../../src/theme/tokens.ts';
import {
  Badge,
  Body,
  Button,
  ErrorBox,
  Loading,
  Muted,
  Notice,
  Screen,
} from '../../src/theme/ui.tsx';
import { methodLabel, sourceTone } from './index.tsx';

/** Wompi entrega el HTML del reto escapado; se restauran las entidades básicas. */
export function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export default function PaymentMethodScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, td } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(true);
  const method = useQuery(
    async () => {
      const result = await auth.api.get<PaymentMethod>(`/payment-methods/${id}`);
      setPending(result.sourceStatus === 'PENDING');
      return result;
    },
    [id],
    { enabled: Boolean(id), intervalMs: pending ? 3000 : 0 },
  );
  const data = method.data;
  if (method.loading && !data) return <Loading text={t('app.loading')} />;
  if (method.error && !data) {
    return (
      <Screen>
        <ErrorBox
          message={errorMessage(method.error, t('app.offline'))}
          onRetry={() => void method.reload()}
          retryLabel={t('app.retry')}
        />
      </Screen>
    );
  }
  if (!data) return null;
  const challenge =
    data.sourceStatus === 'PENDING' && data.threeDs?.methodData
      ? unescapeHtml(data.threeDs.methodData)
      : null;
  return (
    <Screen scroll={!challenge}>
      <Body>{methodLabel(data)}</Body>
      <Badge
        tone={sourceTone(data.sourceStatus)}
        text={td(`payment.status.${data.sourceStatus}`)}
      />
      {data.sourceStatus === 'PENDING' ? (
        <Notice tone="info">{challenge ? t('payment.threeDs') : t('payment.threeDsWait')}</Notice>
      ) : null}
      {challenge && Platform.OS !== 'web' ? (
        <View
          style={{
            flex: 1,
            minHeight: 360,
            borderRadius: 12,
            overflow: 'hidden',
            backgroundColor: colors.surface,
          }}
        >
          <WebView source={{ html: challenge }} style={{ flex: 1 }} />
        </View>
      ) : null}
      {data.sourceStatus === 'AVAILABLE' ? (
        <Notice tone="success">{t('payment.saved')}</Notice>
      ) : null}
      {data.sourceStatus === 'DECLINED' || data.sourceStatus === 'ERROR' ? (
        <Muted>{data.threeDs?.currentStepStatus ?? ''}</Muted>
      ) : null}
      <Button
        title={t('app.back')}
        variant="secondary"
        onPress={() => router.replace('/payment-methods')}
      />
    </Screen>
  );
}
