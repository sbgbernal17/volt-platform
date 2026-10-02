/**
 * Escáner del código QR del cargador (handoff, pantallas 07 y 20): cámara a pantalla completa con
 * máscara y visor de 260 px, linterna, entrada manual del identificador, permiso denegado y código
 * inválido. En el navegador también usa la cámara (expo-camera lee el QR con el BarcodeDetector
 * nativo de Chrome o con su decodificador WebAssembly en Safari): hace falta HTTPS y el permiso del
 * sitio; si el navegador no puede, queda la entrada manual con la explicación.
 *
 * La máscara oscura forma parte de la misma columna que el visor (franja superior, fila con el
 * visor transparente en medio y franja inferior), así el hueco coincide siempre con las esquinas y
 * no depende de posiciones en porcentaje, que en iOS y Android dejaban la cámara visible solo en
 * una "T" (franja superior y columna central) con el resto negro.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../src/i18n/index.tsx';
import { parseEvseQr } from '../src/lib/qr.ts';
import { Icon } from '../src/theme/icon.tsx';
import { colors, radius, spacing, text } from '../src/theme/tokens.ts';
import { Button, Field, IconButton, Note, Screen, Subtitle, TopBar } from '../src/theme/ui.tsx';

const WINDOW = 260;

/** La cámara del navegador exige contexto seguro (HTTPS o localhost) y getUserMedia. */
function webCameraSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof globalThis.isSecureContext === 'undefined')
    return true;
  return Boolean(globalThis.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

export default function ScanScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState(false);
  /** Motivo por el que la cámara no está disponible en el navegador (se explica sobre la entrada manual). */
  const [webIssue, setWebIssue] = useState<'unsupported' | 'blocked' | 'error' | null>(() =>
    Platform.OS === 'web' && !webCameraSupported() ? 'unsupported' : null,
  );
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [found, setFound] = useState(false);
  const lastScan = useRef(0);

  const go = (raw: string) => {
    const evseId = parseEvseQr(raw);
    if (!evseId) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setFound(true);
    router.replace(`/evse/${encodeURIComponent(evseId)}`);
  };
  const onScanned = ({ data }: { data: string }) => {
    const now = Date.now();
    if (found || now - lastScan.current < 1500) return;
    lastScan.current = now;
    go(data);
  };
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  const manualPanel = (
    <View style={styles.panel}>
      <Field
        label={t('scan.manual')}
        value={code}
        onChangeText={(value) => {
          setCode(value);
          setInvalid(false);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        placeholder="VOLT-BOG01-CP01-1"
        error={invalid ? t('scan.invalid') : null}
        help={t('scan.enterHelp')}
        onSubmitEditing={() => go(code)}
      />
      <Button title={t('scan.go')} onPress={() => go(code)} disabled={!code.trim()} />
      {webIssue !== 'unsupported' ? (
        <Button
          title={webIssue ? t('scan.retry') : t('scan.again')}
          variant="ghost"
          icon="qr-code-scanner"
          onPress={() => {
            setWebIssue(null);
            setManual(false);
          }}
        />
      ) : null}
    </View>
  );

  if (manual || webIssue) {
    const hint =
      webIssue === 'unsupported'
        ? t('scan.webUnsupported')
        : webIssue === 'blocked'
          ? t('scan.webBlocked')
          : webIssue === 'error'
            ? t('scan.cameraError')
            : t('scan.webHint');
    return (
      <Screen scroll={false} padded={false}>
        <TopBar
          onBack={close}
          backLabel={t('app.close')}
          backIcon="close"
          title={t('scan.enterCode')}
        />
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
          <Text style={styles.body}>{hint}</Text>
          {manualPanel}
        </View>
      </Screen>
    );
  }

  // En el navegador la propia cámara pide el permiso al montarse; en nativo se pide antes.
  if (Platform.OS !== 'web' && !permission?.granted) {
    return (
      <Screen scroll={false} padded={false}>
        <TopBar onBack={close} backLabel={t('app.close')} backIcon="close" />
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md, alignItems: 'center' }}>
          <View style={styles.permissionCircle}>
            <Icon name="photo-camera" size={36} color={colors.textSecondary} />
          </View>
          <Subtitle style={{ textAlign: 'center' }}>{t('scan.noPermissionTitle')}</Subtitle>
          <Text style={[styles.body, { textAlign: 'center' }]}>{t('scan.permission')}</Text>
          {permission?.canAskAgain === false ? (
            <Button title={t('scan.openSettings')} onPress={() => void Linking.openSettings()} />
          ) : (
            <Button title={t('scan.allow')} onPress={() => void requestPermission()} />
          )}
          <Button
            title={t('scan.enterCode')}
            variant="secondary"
            icon="keyboard"
            onPress={() => setManual(true)}
          />
        </View>
      </Screen>
    );
  }

  const cornerColor = invalid ? colors.danger : found ? colors.success : colors.brand;
  return (
    <View style={styles.full}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        autofocus="on"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScanned}
        onMountError={(event) => {
          // NotAllowedError: el sitio no tiene permiso; el resto: sin cámara u ocupada.
          setWebIssue(/NotAllowed|Permission|denied/i.test(event.message) ? 'blocked' : 'error');
        }}
      />
      {/* Máscara al 72 % y controles en la misma columna: el hueco transparente es el visor. */}
      <View style={styles.overlay}>
        <View style={[styles.dark, { paddingTop: insets.top + spacing.ms, gap: spacing.md }]}>
          <View style={styles.topRow}>
            <IconButton icon="close" label={t('app.close')} onPress={close} onMap />
            <IconButton
              icon={torch ? 'flashlight-off' : 'flashlight-on'}
              label={t('scan.torch')}
              onPress={() => setTorch((value) => !value)}
              onMap
            />
          </View>
          <View style={{ alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl }}>
            <Subtitle style={{ textAlign: 'center' }}>{t('scan.title')}</Subtitle>
            <Text style={[styles.body, { textAlign: 'center' }]}>{t('scan.help')}</Text>
          </View>
          <View style={{ height: spacing.md }} />
        </View>
        <View style={styles.windowRow}>
          <View style={[styles.dark, { flex: 1 }]} />
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.tl, { borderColor: cornerColor }]} />
            <View style={[styles.corner, styles.tr, { borderColor: cornerColor }]} />
            <View style={[styles.corner, styles.bl, { borderColor: cornerColor }]} />
            <View style={[styles.corner, styles.br, { borderColor: cornerColor }]} />
            {invalid ? <View style={[StyleSheet.absoluteFill, styles.invalidFrame]} /> : null}
          </View>
          <View style={[styles.dark, { flex: 1 }]} />
        </View>
        <View
          style={[
            styles.dark,
            {
              flex: 1,
              paddingTop: spacing.md,
              paddingBottom: insets.bottom + spacing.lg,
              gap: spacing.md,
            },
          ]}
        >
          <Text style={styles.status}>
            {invalid ? t('scan.invalidTitle') : t('scan.searching')}
          </Text>
          <View style={{ flex: 1 }} />
          {invalid ? (
            <View style={styles.sheet}>
              <View style={styles.errorCircle}>
                <Icon name="error" size={28} color={colors.danger} />
              </View>
              <Subtitle>{t('scan.invalidTitle')}</Subtitle>
              <Text style={styles.body}>{t('scan.invalid')}</Text>
              <Button title={t('scan.again')} onPress={() => setInvalid(false)} />
              <Button
                title={t('scan.enterCode')}
                variant="secondary"
                icon="keyboard"
                onPress={() => setManual(true)}
              />
            </View>
          ) : (
            <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
              <Button
                title={t('scan.enterCode')}
                variant="secondary"
                icon="keyboard"
                onPress={() => setManual(true)}
              />
              <Note style={{ textAlign: 'center' }}>{t('scan.enterHelp')}</Note>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: colors.bg },
  dark: { backgroundColor: 'rgba(0,0,0,0.72)' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  windowRow: { flexDirection: 'row', height: WINDOW },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.float,
  },
  viewfinder: { width: WINDOW, height: WINDOW, borderRadius: 16 },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: colors.brand },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 16,
  },
  invalidFrame: { borderWidth: 3, borderColor: colors.danger, borderRadius: 16 },
  status: { ...text.cuerpoS, color: colors.textSecondary, textAlign: 'center' },
  body: { ...text.cuerpo, color: colors.textSecondary },
  panel: { gap: spacing.md },
  sheet: {
    marginHorizontal: spacing.float,
    backgroundColor: colors.surface,
    borderRadius: radius.sheet,
    padding: spacing.lg,
    gap: spacing.ms,
  },
  errorCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
