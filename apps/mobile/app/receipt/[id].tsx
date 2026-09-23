/** Recibo de una sesión (líneas, totales y pago) con la versión imprimible en un WebView. */
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Receipt } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { formatDateTime, formatKwh, formatMoney } from '../../src/lib/format.ts';
import { colors, spacing } from '../../src/theme/tokens.ts';
import {
  Body,
  Button,
  Card,
  Divider,
  ErrorBox,
  Heading,
  Loading,
  Muted,
  Row,
  Screen,
  Title,
} from '../../src/theme/ui.tsx';

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, td, locale } = useI18n();
  const auth = useAuth();
  const [html, setHtml] = useState<string | null>(null);
  const receipt = useQuery(() => auth.api.get<Receipt>(`/sessions/${id}/receipt`), [id], {
    enabled: Boolean(id),
  });
  const data = receipt.data;

  const openHtml = async () => {
    const text = await auth.api.get<string>(`/sessions/${id}/receipt`, { format: 'html' });
    setHtml(typeof text === 'string' ? text : JSON.stringify(text));
  };

  if (receipt.loading && !data) return <Loading text={t('app.loading')} />;
  if (receipt.error && !data) {
    return (
      <Screen>
        <ErrorBox
          message={errorMessage(receipt.error, t('app.offline'))}
          onRetry={() => void receipt.reload()}
          retryLabel={t('app.retry')}
        />
      </Screen>
    );
  }
  if (!data) return null;
  if (html && Platform.OS !== 'web') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <WebView source={{ html }} style={{ flex: 1 }} />
        <View style={{ padding: spacing.md }}>
          <Button title={t('app.close')} variant="secondary" onPress={() => setHtml(null)} />
        </View>
      </View>
    );
  }
  const currency = data.totals.currency;
  return (
    <Screen>
      <Title>{t('receipt.number', { number: data.number })}</Title>
      <Muted>
        {t('receipt.issued')}: {formatDateTime(data.issuedAt, locale)} · {data.sessionNo} ·{' '}
        {data.evseId}
      </Muted>
      <Card>
        <Heading>{t('receipt.lines')}</Heading>
        {data.lines.map((line) => (
          <Row key={line.seq} between>
            <View style={{ flex: 1 }}>
              <Body>{td(`receipt.dimension.${line.dimension}`)}</Body>
              <Muted>
                {line.quantity.replace('.', ',')} {line.unit} ×{' '}
                {formatMoney(line.unitPrice, currency)}
              </Muted>
            </View>
            <Body>{formatMoney(line.total, currency)}</Body>
          </Row>
        ))}
        <Divider />
        <Row between>
          <Muted>{t('session.energy')}</Muted>
          <Body>{formatKwh(data.energyKwh)}</Body>
        </Row>
        <Row between>
          <Muted>{t('receipt.subtotal')}</Muted>
          <Body>{formatMoney(data.totals.subtotal, currency)}</Body>
        </Row>
        <Row between>
          <Muted>{t('receipt.tax')}</Muted>
          <Body>{formatMoney(data.totals.tax, currency)}</Body>
        </Row>
        <Row between>
          <Heading>{t('receipt.total')}</Heading>
          <Heading>{formatMoney(data.totals.total, currency)}</Heading>
        </Row>
        {data.payment ? (
          <Muted>
            {t('receipt.paidWith')}: {data.payment.provider}{' '}
            {data.payment.reference ? `· ${data.payment.reference}` : ''}
            {data.payment.paidAt ? ` · ${formatDateTime(data.payment.paidAt, locale)}` : ''}
          </Muted>
        ) : null}
      </Card>
      {Platform.OS !== 'web' ? (
        <Button title={t('receipt.openHtml')} variant="secondary" onPress={() => void openHtml()} />
      ) : null}
    </Screen>
  );
}
