/**
 * Perfil: nombre, celular verificado por SMS (ADR 0031) y, desde el ADR 0027, documento de identidad
 * (opcional) y factura electrónica. Si la persona marca que requiere factura, el documento pasa a ser
 * obligatorio.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorMessage } from '../src/api/client.ts';
import { DOCUMENT_TYPES, type DocumentType, type Profile } from '../src/api/types.ts';
import { useAuth } from '../src/auth/auth.tsx';
import { useI18n } from '../src/i18n/index.tsx';
import { formatPhone } from '../src/lib/phone.ts';
import { spacing } from '../src/theme/tokens.ts';
import {
  Badge,
  Body,
  Button,
  Chip,
  Field,
  Muted,
  Notice,
  Row,
  Screen,
  Subtitle,
  Toggle,
} from '../src/theme/ui.tsx';

export default function ProfileScreen() {
  const { t, td } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const [firstName, setFirstName] = useState(auth.profile?.firstName ?? '');
  const [lastName, setLastName] = useState(auth.profile?.lastName ?? '');
  const phone = auth.profile?.phone ?? null;
  const phoneVerified = auth.profile?.phoneVerified ?? false;
  const [documentType, setDocumentType] = useState<DocumentType | null>(
    auth.profile?.documentType ?? null,
  );
  const [documentNumber, setDocumentNumber] = useState(auth.profile?.documentNumber ?? '');
  const [wantsInvoice, setWantsInvoice] = useState(auth.profile?.wantsInvoice ?? false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const documentMissing = wantsInvoice && (!documentType || !documentNumber.trim());
  const numeric = documentType !== 'PAS';

  const save = async () => {
    setMessage(null);
    if (documentMissing) {
      setDocumentError(t('profile.documentRequired'));
      return;
    }
    if ((documentType === null) !== (documentNumber.trim() === '')) {
      setDocumentError(t('profile.documentPair'));
      return;
    }
    setDocumentError(null);
    setBusy(true);
    try {
      await auth.api.patch<Profile>('/me', {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        documentType: documentType ?? null,
        documentNumber: documentType ? documentNumber.trim() : null,
        wantsInvoice,
      });
      await auth.refreshProfile();
      setMessage({ tone: 'success', text: t('account.saved') });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : null;
      if (code === 'DOCUMENT_INVALID') setDocumentError(t('profile.documentInvalid'));
      else if (code === 'INVOICE_DOCUMENT_REQUIRED')
        setDocumentError(t('profile.documentRequired'));
      else setMessage({ tone: 'danger', text: errorMessage(caught, t('app.offline')) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Field
        label={t('auth.email')}
        value={auth.profile?.email ?? auth.email ?? ''}
        editable={false}
      />
      <Field
        label={t('auth.firstName')}
        value={firstName}
        onChangeText={setFirstName}
        autoComplete="given-name"
        textContentType="givenName"
      />
      <Field
        label={t('auth.lastName')}
        value={lastName}
        onChangeText={setLastName}
        autoComplete="family-name"
        textContentType="familyName"
      />
      {/* El celular se cambia con un código por SMS (ADR 0031), nunca a mano. */}
      <View style={{ gap: spacing.sm }}>
        <Field label={t('account.phone')} value={formatPhone(phone)} editable={false} />
        <Row style={{ justifyContent: 'space-between' }}>
          {phone ? (
            <Badge
              tone={phoneVerified ? 'success' : 'warning'}
              icon={phoneVerified ? 'check-circle' : 'phone-android'}
              text={phoneVerified ? t('phone.verified') : t('phone.unverified')}
            />
          ) : (
            <Muted>{t('phone.none')}</Muted>
          )}
          <Button
            title={phone && phoneVerified ? t('phone.changeNumber') : t('phone.title')}
            variant="secondary"
            compact
            onPress={() => router.push('/verify-phone')}
          />
        </Row>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Subtitle>{t('profile.documentSection')}</Subtitle>
        <Muted>{t('profile.documentHelp')}</Muted>
        <Row style={{ flexWrap: 'wrap' }}>
          {DOCUMENT_TYPES.map((type) => (
            <Chip
              key={type}
              label={td(`profile.documentType.${type}`)}
              active={documentType === type}
              onPress={() => {
                setDocumentType(documentType === type ? null : type);
                setDocumentError(null);
              }}
            />
          ))}
        </Row>
        <Field
          label={t('profile.documentNumber')}
          value={documentNumber}
          onChangeText={(value) => {
            setDocumentNumber(value);
            setDocumentError(null);
          }}
          keyboardType={numeric ? 'number-pad' : 'default'}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={
            documentType === 'NIT'
              ? '900123456-7'
              : documentType === 'PAS'
                ? 'AB123456'
                : '1020304050'
          }
          error={documentError}
          help={documentType === 'NIT' ? t('profile.nitHelp') : undefined}
        />
      </View>

      <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <Toggle
          value={wantsInvoice}
          onChange={(value) => {
            setWantsInvoice(value);
            setDocumentError(null);
          }}
          label={t('profile.wantsInvoice')}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Body>{t('profile.wantsInvoice')}</Body>
          <Muted>{t('profile.wantsInvoiceHelp')}</Muted>
        </View>
      </Row>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button title={t('app.save')} onPress={() => void save()} loading={busy} />
    </Screen>
  );
}
