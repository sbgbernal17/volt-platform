/**
 * Recibo (handoff, pantalla 15): total grande, estado del pago, líneas del cobro, datos de la
 * sesión, aviso sobre la factura electrónica, descarga del PDF (ADR 0028) y reporte de un problema.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Location, Receipt } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { formatClock, formatDateTime, formatKwh, formatMoney } from '../../src/lib/format.ts';
// Sin extensión: Metro elige receipt-file.native.ts o receipt-file.web.ts según la plataforma.
import { downloadReceipt } from '../../src/lib/receipt-file';
import { chargerNumber } from '../../src/lib/stations.ts';
import { colors, fonts, spacing } from '../../src/theme/tokens.ts';
import {
  Badge,
  Button,
  DataRow,
  ErrorBox,
  IconButton,
  LinkText,
  Loading,
  Muted,
  Note,
  Notice,
  Screen,
  TopBar,
} from '../../src/theme/ui.tsx';

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, td, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMessage, setPdfMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(
    null,
  );
  const receipt = useQuery(() => auth.api.get<Receipt>(`/sessions/${id}/receipt`), [id], {
    enabled: Boolean(id),
  });
  const locations = useQuery(() => auth.api.get<{ items: Location[] }>('/locations'), [], {});
  const data = receipt.data;
  const station = data
    ? (locations.data?.items.find((l) => l.evses.some((e) => e.evseId === data.evseId)) ?? null)
    : null;
  const index = station && data ? station.evses.findIndex((e) => e.evseId === data.evseId) : -1;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/history'));

  const savePdf = async () => {
    if (!data) return;
    setPdfBusy(true);
    setPdfMessage(null);
    try {
      const outcome = await downloadReceipt({
        api: auth.api,
        sessionId: data.sessionId,
        number: data.number,
        title: t('receipt.number', { number: data.number }),
      });
      if (outcome === 'saved') setPdfMessage({ tone: 'success', text: t('receipt.pdfSaved') });
    } catch {
      setPdfMessage({ tone: 'danger', text: t('receipt.pdfError') });
    } finally {
      setPdfBusy(false);
    }
  };
  const share = () => {
    if (!data) return;
    void Share.share({
      message: t('receipt.shareText', {
        number: data.number,
        energy: formatKwh(data.energyKwh),
        total: formatMoney(data.totals.total, data.totals.currency),
      }),
    }).catch(() => undefined);
  };
  const support = auth.config?.legal.supportEmail ?? null;
  const report = () => {
    if (!support || !data) return;
    void Linking.openURL(
      `mailto:${support}?subject=${encodeURIComponent(`Volt · ${data.number}`)}`,
    ).catch(() => undefined);
  };

  if (receipt.loading && !data) return <Loading text={t('app.loading')} />;
  if (receipt.error && !data) {
    return (
      <Screen padded={false}>
        <TopBar onBack={back} backLabel={t('app.back')} />
        <View style={{ paddingHorizontal: spacing.list }}>
          <ErrorBox
            message={errorMessage(receipt.error, t('app.offline'))}
            onRetry={() => void receipt.reload()}
            retryLabel={t('app.retry')}
          />
        </View>
      </Screen>
    );
  }
  if (!data) return null;
  const currency = data.totals.currency;
  const paid = data.paymentStatus === 'CAPTURED' || data.paymentStatus === 'WAIVED';
  return (
    <Screen dense padded={false}>
      <TopBar
        onBack={back}
        backLabel={t('app.back')}
        right={
          Platform.OS !== 'web' ? (
            <IconButton icon="ios-share" label={t('receipt.share')} onPress={share} />
          ) : undefined
        }
      />
      <View style={{ paddingHorizontal: spacing.list, gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          <Muted>{t('receipt.chargeReceipt')}</Muted>
          <Text style={styles.total}>{formatMoney(data.totals.total, currency)}</Text>
          {paid ? (
            <Badge
              tone="success"
              icon="check"
              text={t('receipt.paidOn', {
                when: formatDateTime(data.payment?.paidAt ?? data.issuedAt, locale),
              })}
            />
          ) : (
            <Badge tone="warning" icon="schedule" text={t('receipt.pendingPayment')} />
          )}
          <Muted>
            {t('receipt.number', { number: data.number })} · {data.sessionNo}
          </Muted>
        </View>
        <View>
          <DataRow label={t('receipt.energyDelivered')} value={formatKwh(data.energyKwh)} />
          {data.lines.map((line) => (
            <DataRow
              key={line.seq}
              label={`${td(`receipt.dimension.${line.dimension}`)} · ${line.quantity.replace('.', ',')} ${line.unit} × ${formatMoney(line.unitPrice, currency)}`}
              value={formatMoney(line.total, currency)}
            />
          ))}
          {data.totals.tax !== '0' && data.totals.tax !== '0.00' ? (
            <DataRow label={t('receipt.tax')} value={formatMoney(data.totals.tax, currency)} />
          ) : null}
          <DataRow
            label={t('receipt.totalVat')}
            value={formatMoney(data.totals.total, currency)}
            strong
          />
        </View>
        <View>
          <DataRow label={t('session.station')} value={station?.name ?? data.chargeBoxId} />
          <DataRow
            label={t('session.charger')}
            value={index >= 0 ? `${chargerNumber(index)} · ${data.evseId}` : data.evseId}
          />
          <DataRow
            label={t('receipt.startEnd')}
            value={`${formatClock(data.startedAt)} – ${formatClock(data.endedAt)}`}
          />
          <DataRow
            label={t('receipt.paymentMethod')}
            value={
              data.payment
                ? `${data.payment.provider}${data.payment.reference ? ` · ${data.payment.reference}` : ''}`
                : '—'
            }
          />
        </View>
        <Notice tone="neutral" icon="description">
          {t('receipt.dianNote')}
        </Notice>
        <Button
          title={t('receipt.pdf')}
          variant="secondary"
          icon="download"
          loading={pdfBusy}
          onPress={() => void savePdf()}
        />
        {pdfMessage ? <Notice tone={pdfMessage.tone}>{pdfMessage.text}</Notice> : null}
        {support ? (
          <View style={{ alignItems: 'center' }}>
            <LinkText onPress={report}>{t('receipt.report')}</LinkText>
          </View>
        ) : null}
        <Note style={{ textAlign: 'center' }}>{t('receipt.legal')}</Note>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: {
    fontFamily: fonts.title,
    fontSize: 48,
    lineHeight: 52,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});
