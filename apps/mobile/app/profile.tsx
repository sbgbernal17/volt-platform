import { useState } from 'react';
import { errorMessage } from '../src/api/client.ts';
import type { Profile } from '../src/api/types.ts';
import { useAuth } from '../src/auth/auth.tsx';
import { useI18n } from '../src/i18n/index.tsx';
import { Button, Field, Notice, Screen } from '../src/theme/ui.tsx';

export default function ProfileScreen() {
  const { t } = useI18n();
  const auth = useAuth();
  const [name, setName] = useState(auth.profile?.displayName ?? '');
  const [phone, setPhone] = useState(auth.profile?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await auth.api.patch<Profile>('/me', {
        displayName: name.trim() || null,
        phone: phone.trim() || null,
      });
      await auth.refreshProfile();
      setMessage({ tone: 'success', text: t('account.saved') });
    } catch (caught) {
      setMessage({ tone: 'danger', text: errorMessage(caught, t('app.offline')) });
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
      <Field label={t('auth.name')} value={name} onChangeText={setName} />
      <Field
        label={t('account.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="+57 300 123 4567"
      />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button title={t('app.save')} onPress={() => void save()} loading={busy} />
    </Screen>
  );
}
