/** Lectura del QR del conector con la cámara y entrada manual del identificador. */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useI18n } from '../../src/i18n/index.tsx';
import { parseEvseQr } from '../../src/lib/qr.ts';
import { colors, spacing } from '../../src/theme/tokens.ts';
import { Body, Button, Field, Muted, Notice, Screen } from '../../src/theme/ui.tsx';

export default function Scan() {
  const { t } = useI18n();
  const router = useRouter();
  const [focused, setFocused] = useState(false);
  // La cámara solo se monta con la pestaña visible (ahorra batería y evita lecturas de fondo).
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lastScan = useRef(0);

  const go = (raw: string) => {
    const evseId = parseEvseQr(raw);
    if (!evseId) {
      setError(t('scan.invalid'));
      return;
    }
    setError(null);
    router.push(`/evse/${encodeURIComponent(evseId)}`);
  };
  const onScanned = ({ data }: { data: string }) => {
    const now = Date.now();
    if (now - lastScan.current < 2000) return;
    lastScan.current = now;
    go(data);
  };
  const cameraAvailable = Platform.OS !== 'web';

  return (
    <Screen>
      <Body>{t('scan.help')}</Body>
      {cameraAvailable ? (
        permission?.granted ? (
          <View style={styles.camera}>
            {focused ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onScanned}
              />
            ) : null}
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Muted>{t('scan.permission')}</Muted>
            <Button
              title={t('scan.allow')}
              variant="secondary"
              onPress={() => void requestPermission()}
            />
          </View>
        )
      ) : (
        <Notice tone="info">{t('scan.webHint')}</Notice>
      )}
      <Field
        label={t('scan.manual')}
        value={manual}
        onChangeText={setManual}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="VOLT-BOG01-CP01-1"
        onSubmitEditing={() => go(manual)}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button title={t('scan.go')} onPress={() => go(manual)} disabled={!manual.trim()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  camera: { height: 280, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
});
