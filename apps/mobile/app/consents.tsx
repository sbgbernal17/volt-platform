/** Consentimientos obligatorios (términos y autorización de datos, Ley 1581) y mercadeo opcional. */

import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { errorMessage } from '../src/api/client.ts';
import type { ConsentKey } from '../src/api/types.ts';
import { useAuth } from '../src/auth/auth.tsx';
import { useI18n } from '../src/i18n/index.tsx';
import { colors, spacing } from '../src/theme/tokens.ts';
import { Body, Button, LinkText, Muted, Notice, Row, Screen, Title } from '../src/theme/ui.tsx';

export default function Consents() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [terms, setTerms] = useState(false);
  const [data, setData] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const legal = auth.config?.legal;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const keys: ConsentKey[] = [
        'terms',
        'data_processing',
        ...(marketing ? (['marketing'] as const) : []),
      ];
      await auth.acceptConsents(keys, locale);
      router.replace('/(tabs)');
    } catch (caught) {
      setError(errorMessage(caught, t('app.offline')));
    } finally {
      setBusy(false);
    }
  };

  const Item = ({
    value,
    onChange,
    text,
  }: {
    value: boolean;
    onChange: (v: boolean) => void;
    text: string;
  }) => (
    <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.field }}
        thumbColor={colors.text}
      />
      <Body style={{ flex: 1 }}>{text}</Body>
    </Row>
  );

  return (
    <Screen>
      <Title>{t('consent.title')}</Title>
      <Body>{t('consent.intro')}</Body>
      <View style={{ gap: spacing.md }}>
        <Item value={terms} onChange={setTerms} text={t('consent.terms')} />
        <Item value={data} onChange={setData} text={t('consent.data')} />
        <Item value={marketing} onChange={setMarketing} text={t('consent.marketing')} />
      </View>
      <Row between>
        {legal ? (
          <LinkText onPress={() => void WebBrowser.openBrowserAsync(legal.termsUrl)}>
            {t('consent.readTerms')}
          </LinkText>
        ) : null}
        {legal ? (
          <LinkText onPress={() => void WebBrowser.openBrowserAsync(legal.privacyUrl)}>
            {t('consent.readPrivacy')}
          </LinkText>
        ) : null}
      </Row>
      <Muted>{t('consent.required')}</Muted>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        title={t('consent.accept')}
        onPress={() => void submit()}
        loading={busy}
        disabled={!terms || !data}
      />
      <Button title={t('auth.signOut')} variant="ghost" onPress={() => void auth.signOut()} />
    </Screen>
  );
}
