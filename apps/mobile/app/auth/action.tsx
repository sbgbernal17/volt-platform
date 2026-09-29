/**
 * Página de acción de los correos de Identity Platform (iteración 9, ADR 0024): los enlaces de
 * verificación de correo, contraseña nueva, restauración de correo y retiro del segundo factor
 * llegan aquí (`?mode=…&oobCode=…`) en lugar de la página genérica de Google, con la marca VOLT.
 * Es pública: no exige sesión y funciona aunque el enlace se abra en otro dispositivo.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useAuth } from '../../src/auth/auth.tsx';
import { BrandHeader } from '../../src/components/brand-header.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { spacing } from '../../src/theme/tokens.ts';
import {
  Body,
  Button,
  Field,
  LinkText,
  Loading,
  Muted,
  Notice,
  Screen,
  Title,
} from '../../src/theme/ui.tsx';

type Outcome =
  | { kind: 'working' }
  | { kind: 'reset'; email: string }
  | { kind: 'done'; what: 'verified' | 'resetDone' | 'recovered' | 'revertDone' }
  | { kind: 'error'; what: 'invalid' | 'unavailable' };

/** Host del back-office a partir del de la app web (app-dev → admin-dev; app → admin, ADR 0019). */
function backofficeUrl(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const host = window.location.host;
  if (!/^app([-.])/.test(host)) return null;
  return `https://${host.replace(/^app(?=[-.])/, 'admin')}`;
}

export default function EmailActionScreen() {
  const params = useLocalSearchParams<{ mode?: string; oobCode?: string }>();
  const { t } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const mode = typeof params.mode === 'string' ? params.mode : '';
  const code = typeof params.oobCode === 'string' ? params.oobCode : '';
  const ready = auth.config !== null;
  const available = auth.config?.auth.provider === 'identity-platform';
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'working' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const admin = backofficeUrl();
  // El enlace se procesa una sola vez: el estado de la sesión se lee por referencia.
  const authRef = useRef(auth);
  authRef.current = auth;

  useEffect(() => {
    if (!ready) return;
    if (!available || !code) {
      setOutcome({ kind: 'error', what: available ? 'invalid' : 'unavailable' });
      return;
    }
    let cancelled = false;
    const run = async () => {
      const current = authRef.current;
      try {
        switch (mode) {
          case 'verifyEmail': {
            await current.emailAction.apply(code);
            if (current.status === 'authenticated')
              await current.checkVerification().catch(() => false);
            if (!cancelled) setOutcome({ kind: 'done', what: 'verified' });
            break;
          }
          case 'resetPassword': {
            const email = await current.emailAction.verifyReset(code);
            if (!cancelled) setOutcome({ kind: 'reset', email });
            break;
          }
          case 'recoverEmail': {
            await current.emailAction.apply(code);
            if (!cancelled) setOutcome({ kind: 'done', what: 'recovered' });
            break;
          }
          case 'revertSecondFactorAddition': {
            await current.emailAction.apply(code);
            if (!cancelled) setOutcome({ kind: 'done', what: 'revertDone' });
            break;
          }
          default:
            if (!cancelled) setOutcome({ kind: 'error', what: 'invalid' });
        }
      } catch {
        if (!cancelled) setOutcome({ kind: 'error', what: 'invalid' });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ready, available, mode, code]);

  const submitPassword = async () => {
    if (password.length < 8) return;
    setBusy(true);
    try {
      await auth.emailAction.confirmReset(code, password);
      setOutcome({ kind: 'done', what: 'resetDone' });
    } catch {
      setOutcome({ kind: 'error', what: 'invalid' });
    } finally {
      setBusy(false);
    }
  };
  const doneText = (what: Extract<Outcome, { kind: 'done' }>['what']) =>
    what === 'verified'
      ? t('action.verified')
      : what === 'resetDone'
        ? t('action.resetDone')
        : what === 'recovered'
          ? t('action.recovered')
          : t('action.revertDone');

  const openApp = () => {
    if (Platform.OS === 'web') router.replace('/');
    else void Linking.openURL('volt://');
  };

  return (
    <Screen padded={false}>
      <BrandHeader compact />
      <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
        {outcome.kind === 'working' ? (
          <Loading text={mode === 'verifyEmail' ? t('action.verifying') : t('app.loading')} />
        ) : null}
        {outcome.kind === 'reset' ? (
          <>
            <Title>{t('action.resetTitle')}</Title>
            <Muted>{t('action.resetFor', { email: outcome.email })}</Muted>
            <Field
              label={t('action.newPassword')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              help={t('auth.passwordHelp')}
              onSubmitEditing={() => void submitPassword()}
            />
            <Button
              title={t('app.save')}
              onPress={() => void submitPassword()}
              loading={busy}
              disabled={password.length < 8}
            />
          </>
        ) : null}
        {outcome.kind === 'done' ? (
          <>
            <Title>{t('action.doneTitle')}</Title>
            <Notice tone="success">{doneText(outcome.what)}</Notice>
            {mode === 'verifyEmail' ? <Body>{t('action.verifiedHelp')}</Body> : null}
            <Button title={t('action.openApp')} onPress={openApp} />
          </>
        ) : null}
        {outcome.kind === 'error' ? (
          <>
            <Title>{t('action.errorTitle')}</Title>
            <Notice tone="danger">
              {outcome.what === 'unavailable' ? t('auth.unavailable') : t('action.invalid')}
            </Notice>
            <Button title={t('action.openApp')} variant="secondary" onPress={openApp} />
          </>
        ) : null}
        {admin && outcome.kind !== 'working' ? (
          <LinkText onPress={() => void Linking.openURL(admin)}>{t('action.staff')}</LinkText>
        ) : null}
      </View>
    </Screen>
  );
}
