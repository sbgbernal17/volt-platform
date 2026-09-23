/** Historial de cargas (las que siguen abiertas primero). */
import { useRouter } from 'expo-router';
import { errorMessage } from '../../src/api/client.ts';
import { useQuery } from '../../src/api/hooks.ts';
import type { Session } from '../../src/api/types.ts';
import { useAuth } from '../../src/auth/auth.tsx';
import { isSessionOpen, SessionItem } from '../../src/components/session-item.tsx';
import { useI18n } from '../../src/i18n/index.tsx';
import { Empty, ErrorBox, Heading, Loading, Screen } from '../../src/theme/ui.tsx';

export default function History() {
  const { t } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const sessions = useQuery(
    () => auth.api.get<{ items: Session[] }>('/sessions', { limit: 50 }),
    [],
    { intervalMs: 10_000 },
  );
  if (sessions.loading && !sessions.data) return <Loading text={t('app.loading')} />;
  const items = sessions.data?.items ?? [];
  const open = items.filter(isSessionOpen);
  const closed = items.filter((s) => !isSessionOpen(s));
  return (
    <Screen>
      {sessions.error && !sessions.data ? (
        <ErrorBox
          message={errorMessage(sessions.error, t('app.offline'))}
          onRetry={() => void sessions.reload()}
          retryLabel={t('app.retry')}
        />
      ) : null}
      {items.length === 0 && !sessions.error ? <Empty text={t('history.empty')} /> : null}
      {open.length ? <Heading>{t('history.active')}</Heading> : null}
      {open.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          onPress={() => router.push(`/session/${session.id}`)}
        />
      ))}
      {open.length && closed.length ? <Heading>{t('history.title')}</Heading> : null}
      {closed.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          onPress={() => router.push(`/session/${session.id}`)}
        />
      ))}
    </Screen>
  );
}
