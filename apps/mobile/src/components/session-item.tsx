/** Tarjeta de una sesión (historial y en curso) con estado, energía y total. */
import type { Session } from '../api/types.ts';
import { useI18n } from '../i18n/index.tsx';
import { formatDateTime, formatKwh, formatMoney } from '../lib/format.ts';
import type { Tone } from '../theme/tokens.ts';
import { Badge, Body, Card, Muted, Row } from '../theme/ui.tsx';

export const ACTIVE_STATES = new Set(['REQUESTED', 'STARTING', 'ACTIVE', 'STOPPING']);
export const FINISHED_STATES = new Set(['PAID', 'FAILED', 'CANCELLED', 'EXPIRED']);

/** Estado que ve el conductor: el de la app más PAID y EXPIRED, que la proyección agrupa (ARQ §1.4). */
export type DisplayState = Session['state'] | 'PAID' | 'EXPIRED';

export function displayState(session: Pick<Session, 'state' | 'detailedState'>): DisplayState {
  if (session.detailedState === 'PAID') return 'PAID';
  if (session.detailedState === 'EXPIRED') return 'EXPIRED';
  return session.state;
}

export function isSessionOpen(session: Session): boolean {
  const state = displayState(session);
  if (FINISHED_STATES.has(state)) return false;
  if (state === 'SETTLED' && session.paymentStatus === 'WAIVED') return false;
  return true;
}

export function sessionTone(state: DisplayState): Tone {
  switch (state) {
    case 'ACTIVE':
    case 'STARTING':
    case 'REQUESTED':
      return 'info';
    case 'PAID':
      return 'success';
    case 'FAILED':
    case 'EXPIRED':
    case 'CANCELLED':
      return 'danger';
    case 'ENDED':
    case 'SETTLED':
    case 'STOPPING':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function SessionItem({ session, onPress }: { session: Session; onPress: () => void }) {
  const { t, td, locale } = useI18n();
  const total = session.cost ? formatMoney(session.cost.total, session.cost.currency) : '—';
  const state = displayState(session);
  return (
    <Card onPress={onPress}>
      <Row between>
        <Body>{session.evseId}</Body>
        <Badge tone={sessionTone(state)} text={td(`session.state.${state}`)} />
      </Row>
      <Row between>
        <Muted>{formatDateTime(session.startedAt ?? session.requestedAt, locale)}</Muted>
        <Muted>{formatKwh(session.energyKwh)}</Muted>
        <Body>
          {session.cost?.isFinal
            ? total
            : ACTIVE_STATES.has(session.state)
              ? `${t('session.costSoFar')}: ${total}`
              : total}
        </Body>
      </Row>
    </Card>
  );
}
