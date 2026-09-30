/**
 * Bienvenida (handoff, pantalla 01): logotipo, ilustración con marcadores, titular, crear cuenta,
 * iniciar sesión y explorar el mapa sin cuenta.
 */
import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/auth.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { Icon } from '../../src/theme/icon.tsx';
import { colors, fonts, spacing, text } from '../../src/theme/tokens.ts';
import { Button, Display, LinkText, Screen } from '../../src/theme/ui.tsx';

function MiniMarker({ label, tone }: { label: string; tone: 'success' | 'warning' }) {
  return (
    <View style={styles.marker}>
      <View
        style={[
          styles.markerDot,
          { backgroundColor: tone === 'success' ? colors.successSoft : colors.warningSoft },
        ]}
      >
        <Icon
          name={tone === 'success' ? 'check' : 'schedule'}
          size={16}
          color={tone === 'success' ? colors.success : colors.warning}
        />
      </View>
      <Text style={styles.markerText}>{label}</Text>
    </View>
  );
}

export default function Welcome() {
  const { t, locale, setLocale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const explore = () => {
    auth.browseAsGuest();
    router.replace('/(tabs)');
  };
  return (
    <Screen scroll={false} padded={false} style={{ paddingTop: insets.top + spacing.md }}>
      <View style={styles.top}>
        <Image
          source={require('../../assets/logo-blanco.png')}
          style={styles.logo}
          accessibilityLabel="VOLT"
          resizeMode="contain"
        />
        <LinkText
          onPress={() => setLocale(locale === 'es' ? 'en' : 'es')}
          style={{ color: colors.textSecondary }}
        >
          {locale === 'es' ? t('app.english') : t('app.spanish')}
        </LinkText>
      </View>
      <View style={styles.illustration}>
        <View style={[styles.ring, { width: 300, height: 300 }]} />
        <View style={[styles.ring, { width: 200, height: 200 }]} />
        <View style={styles.core}>
          <Icon name="bolt" size={56} color={colors.onPrimary} />
        </View>
        <View style={{ position: 'absolute', top: 36, left: 12 }}>
          <MiniMarker label="4/6" tone="success" />
        </View>
        <View style={{ position: 'absolute', top: 96, right: 8 }}>
          <MiniMarker label="2/3" tone="success" />
        </View>
        <View style={{ position: 'absolute', bottom: 8, right: 52 }}>
          <MiniMarker label="0/4" tone="warning" />
        </View>
      </View>
      <View style={styles.steps}>
        <View style={[styles.step, { width: 24, backgroundColor: colors.brand }]} />
        <View style={styles.step} />
        <View style={styles.step} />
      </View>
      <View
        style={{
          paddingHorizontal: spacing.xl,
          gap: spacing.md,
          flex: 1,
          justifyContent: 'flex-end',
          paddingBottom: insets.bottom + spacing.lg,
        }}
      >
        <Display>{t('onboarding.title')}</Display>
        <Text style={styles.lead}>{t('onboarding.body')}</Text>
        <View style={{ height: spacing.sm }} />
        <Button title={t('onboarding.create')} onPress={() => router.push('/(auth)/sign-up')} />
        <Button
          title={t('onboarding.signIn')}
          variant="secondary"
          onPress={() => router.push('/(auth)/sign-in')}
        />
        <Button title={t('onboarding.explore')} variant="ghost" onPress={explore} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  logo: { width: 128, height: 55 },
  illustration: {
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  ring: { position: 'absolute', borderRadius: 150, borderWidth: 1, borderColor: colors.line },
  core: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingLeft: 4,
    paddingRight: 10,
    borderRadius: 17,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: colors.handle,
  },
  markerDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  steps: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  step: { width: 8, height: 4, borderRadius: 2, backgroundColor: colors.borderSoft },
  lead: { ...text.cuerpoL, color: colors.textSecondary },
});
