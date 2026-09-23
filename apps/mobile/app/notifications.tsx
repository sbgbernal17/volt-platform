/** Bandeja de avisos (lo que se envió por push, también legible sin permisos de notificación). */
import { useRouter } from 'expo-router';
import { errorMessage } from '../src/api/client.ts';
import { useQuery } from '../src/api/hooks.ts';
import type { AppNotification } from '../src/api/types.ts';
import { useAuth } from '../src/auth/auth.tsx';
import { useI18n } from '../src/i18n/index.tsx';
import { formatDateTime } from '../src/lib/format.ts';
import { colors } from '../src/theme/tokens.ts';
import {
  Body,
  Button,
  Card,
  Empty,
  ErrorBox,
  Heading,
  Loading,
  Muted,
  Screen,
} from '../src/theme/ui.tsx';

export default function NotificationsScreen() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const list = useQuery(
    () =>
      auth.api.get<{ items: AppNotification[]; unread: number }>('/me/notifications', {
        limit: 50,
      }),
    [],
    {},
  );
  const markAll = async () => {
    await auth.api.post('/me/notifications/read', {});
    await list.reload();
  };
  if (list.loading && !list.data) return <Loading text={t('app.loading')} />;
  const items = list.data?.items ?? [];
  return (
    <Screen>
      {list.error && !list.data ? (
        <ErrorBox
          message={errorMessage(list.error, t('app.offline'))}
          onRetry={() => void list.reload()}
          retryLabel={t('app.retry')}
        />
      ) : null}
      {items.length === 0 && !list.error ? <Empty text={t('notifications.empty')} /> : null}
      {items.map((item) => (
        <Card
          key={item.id}
          style={item.readAt ? undefined : { borderColor: colors.brand }}
          onPress={item.sessionId ? () => router.push(`/session/${item.sessionId}`) : undefined}
        >
          <Heading>{item.title}</Heading>
          <Body>{item.body}</Body>
          <Muted>{formatDateTime(item.createdAt, locale)}</Muted>
        </Card>
      ))}
      {list.data?.unread ? (
        <Button
          title={t('notifications.markRead')}
          variant="secondary"
          onPress={() => void markAll()}
        />
      ) : null}
    </Screen>
  );
}
