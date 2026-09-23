/**
 * Notificaciones push al conductor (iteración 7, ADR 0022): consume los eventos de dominio del outbox
 * con una bandeja idempotente (`ops.consumer_inbox`, consumidor `push`), construye el texto en el
 * idioma de cada dispositivo (docs/textos-app-conductor.md), deja rastro en `auth.driver_notification`
 * (bandeja de la app) y envía por Expo Push. Entrega "a lo sumo una vez" por evento; un token que
 * Expo rechaza (`DeviceNotRegistered`) queda inválido hasta que la app lo registre de nuevo.
 */
import {
  buildPushText,
  type DriverLocale,
  getDriver,
  getSessionView,
  hasSessionNotification,
  insertDriverNotification,
  isPushKind,
  listDriverDevices,
  loadSessionSnapshot,
  markDeviceInvalid,
  type OutboxRow,
  type PaymentMethodRow,
  type PaymentRow,
  type PushKind,
  type PushVars,
  previewFromSnapshot,
  resolveParam,
  type SessionView,
  updateDriverNotification,
} from '@volt/csms';
import type { Sql } from 'postgres';
import type { SchedulerLogger } from '../scheduler.ts';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export type PushTicket =
  | { ok: true; id?: string | undefined }
  | { ok: false; message: string; error?: string | undefined };

/** Puerto de envío: Expo Push en producción, registro en desarrollo, memoria en pruebas. */
export interface PushSender {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo admite hasta 100 mensajes por petición. */
const EXPO_CHUNK = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export class ExpoPushSender implements PushSender {
  private readonly fetchImpl: typeof fetch;
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly accessToken: string | undefined;

  constructor(
    options: {
      accessToken?: string | undefined;
      fetchImpl?: typeof fetch | undefined;
      url?: string | undefined;
      timeoutMs?: number | undefined;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.url = options.url ?? EXPO_PUSH_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.accessToken = options.accessToken;
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
      const chunk = messages.slice(i, i + EXPO_CHUNK);
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(
          chunk.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            priority: 'high',
            channelId: 'volt',
          })),
        ),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`Expo Push respondió ${response.status}`);
      const payload = (await response.json()) as {
        data?: ExpoTicket[];
        errors?: { code?: string; message?: string }[];
      };
      if (payload.errors?.length) {
        throw new Error(`Expo Push rechazó el lote: ${payload.errors[0]?.message ?? 'error'}`);
      }
      const data = payload.data ?? [];
      for (let j = 0; j < chunk.length; j++) {
        const ticket = data[j];
        if (!ticket) tickets.push({ ok: false, message: 'sin ticket' });
        else if (ticket.status === 'ok') tickets.push({ ok: true, id: ticket.id });
        else
          tickets.push({
            ok: false,
            message: ticket.message ?? 'error',
            error: ticket.details?.error,
          });
      }
    }
    return tickets;
  }
}

/** Solo registra en el log (desarrollo sin Expo). */
export class LogPushSender implements PushSender {
  constructor(private readonly logger: SchedulerLogger) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    for (const message of messages) {
      this.logger.info(
        { to: maskToken(message.to), title: message.title, body: message.body },
        'notificación push (log)',
      );
    }
    return messages.map(() => ({ ok: true }));
  }
}

/** Emulador para pruebas: guarda los mensajes y responde según `respond`. */
export class MemoryPushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  respond: ((message: PushMessage) => PushTicket) | undefined;
  failNext = false;

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('envío fallido (simulado)');
    }
    this.sent.push(...messages);
    return messages.map((m) => this.respond?.(m) ?? { ok: true, id: `t-${this.sent.length}` });
  }
}

function maskToken(token: string): string {
  return token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-4)}` : '…';
}

const CONSUMER = 'push';

/** Evento de dominio → clase de notificación (con la condición adicional que aplique). */
const EVENT_KINDS: Record<string, PushKind> = {
  'session.started': 'SESSION_STARTED',
  'session.suspended': 'IDLE_STARTED',
  'session.exposure_warning': 'EXPOSURE_WARNING',
  'session.exposure_exhausted': 'EXPOSURE_EXHAUSTED',
  'session.expired': 'SESSION_EXPIRED',
  'session.settled': 'SESSION_SETTLED',
  'payment.captured': 'PAYMENT_CAPTURED',
  'payment.failed': 'PAYMENT_FAILED',
};
const EVENT_TYPES = Object.keys(EVENT_KINDS);
/** Clases que solo se avisan una vez por sesión aunque el evento se repita. */
const ONCE_PER_SESSION: readonly PushKind[] = ['IDLE_STARTED', 'EXPOSURE_WARNING'];

interface Outgoing {
  notificationId: string;
  message: PushMessage;
}

export interface DeliverOptions {
  batch?: number | undefined;
  lookbackH?: number | undefined;
  logger?: SchedulerLogger | undefined;
}

export interface DeliverResult {
  processed: number;
  queued: number;
  sent: number;
}

/**
 * Un ciclo: toma los eventos de interés no procesados por este consumidor, los reclama en la bandeja,
 * prepara las notificaciones (una por conductor y evento) y envía en lote a los dispositivos activos.
 */
export async function deliverPushNotifications(
  sql: Sql,
  sender: PushSender,
  options: DeliverOptions = {},
): Promise<DeliverResult> {
  const batch = options.batch ?? 100;
  const lookbackH = options.lookbackH ?? 24;
  const events = await sql<OutboxRow[]>`
    SELECT e.* FROM ops.event_outbox e
    WHERE e.type = ANY(${EVENT_TYPES}::text[])
      AND e.created_at > now() - make_interval(hours => ${lookbackH})
      AND NOT EXISTS (SELECT 1 FROM ops.consumer_inbox i WHERE i.consumer = ${CONSUMER} AND i.event_id = e.event_id)
    ORDER BY e.id LIMIT ${batch}`;
  const outgoing: Outgoing[] = [];
  let processed = 0;
  for (const event of events) {
    const claimed = await sql`
      INSERT INTO ops.consumer_inbox (consumer, event_id, outcome) VALUES (${CONSUMER}, ${event.event_id}, 'PROCESSING')
      ON CONFLICT DO NOTHING RETURNING event_id`;
    if (claimed.length === 0) continue;
    processed++;
    let outcome: string;
    try {
      outcome = await prepareEvent(sql, event, outgoing);
    } catch (error) {
      outcome = `ERROR: ${(error as Error).message}`.slice(0, 200);
      options.logger?.error(
        { err: error, eventId: event.event_id, type: event.type },
        'notificación no preparada',
      );
    }
    await sql`
      UPDATE ops.consumer_inbox SET outcome = ${outcome}, processed_at = now()
      WHERE consumer = ${CONSUMER} AND event_id = ${event.event_id}`;
  }
  outgoing.push(...(await retryPending(sql)));
  const sent = outgoing.length ? await sendOutgoing(sql, sender, outgoing, options.logger) : 0;
  return { processed, queued: outgoing.length, sent };
}

async function prepareEvent(sql: Sql, event: OutboxRow, outgoing: Outgoing[]): Promise<string> {
  const kind = EVENT_KINDS[event.type];
  if (!kind) return 'SKIPPED:KIND';
  const payload = (event.payload?.payload ?? {}) as Record<string, unknown>;
  if (kind === 'IDLE_STARTED' && payload.to !== 'SUSPENDED_EV') return 'SKIPPED:NOT_IDLE';
  if (kind === 'SESSION_EXPIRED' && payload.reason !== 'start_deadline') return 'SKIPPED:REASON';
  const enabled = await resolveParam<unknown[]>(sql, 'notifications.push_kinds', {
    tenantId: event.tenant_id,
  });
  if (!Array.isArray(enabled) || !enabled.filter(isPushKind).includes(kind))
    return 'SKIPPED:DISABLED';

  const sessionId =
    event.aggregate_type === 'session'
      ? event.aggregate_id
      : typeof payload.sessionId === 'string'
        ? payload.sessionId
        : null;
  const session = sessionId ? await getSessionView(sql, sessionId) : null;
  if (session?.is_test) return 'SKIPPED:TEST';
  const driverId =
    session?.driver_id ?? (typeof payload.driverId === 'string' ? payload.driverId : null);
  if (!driverId) return 'SKIPPED:NO_DRIVER';
  const driver = await getDriver(sql, driverId);
  if (driver.anonymized_at || driver.status === 'DELETED') return 'SKIPPED:DRIVER_DELETED';
  if (session && ONCE_PER_SESSION.includes(kind)) {
    if (await hasSessionNotification(sql, driverId, session.id, kind)) return 'SKIPPED:DUPLICATE';
  }
  const vars = await buildVars(sql, kind, payload, session);
  const devices = await listDriverDevices(sql, driverId);
  const driverLocale: DriverLocale = driver.locale === 'en' ? 'en' : 'es';
  const text = buildPushText(kind, driverLocale, vars);
  const data = {
    kind,
    sessionId: session?.id ?? null,
    sessionNo: session?.session_no ?? null,
    eventId: event.event_id,
  };
  const row = await insertDriverNotification(sql, {
    tenantId: event.tenant_id,
    driverId,
    eventId: event.event_id,
    kind,
    sessionId: session?.id ?? null,
    locale: driverLocale,
    title: text.title,
    body: text.body,
    data,
    status: devices.length ? 'PENDING' : 'NO_DEVICE',
  });
  if (!row) return 'SKIPPED:DUPLICATE';
  if (devices.length === 0) return 'NO_DEVICE';
  for (const device of devices) {
    const localized =
      device.locale === driverLocale ? text : buildPushText(kind, device.locale, vars);
    outgoing.push({
      notificationId: row.id,
      message: {
        to: device.push_token,
        title: localized.title,
        body: localized.body,
        data: { ...data, notificationId: row.id },
      },
    });
  }
  return 'QUEUED';
}

async function buildVars(
  sql: Sql,
  kind: PushKind,
  payload: Record<string, unknown>,
  session: SessionView | null,
): Promise<PushVars[PushKind]> {
  const money = (value: unknown): bigint => {
    try {
      return BigInt(String(value ?? 0));
    } catch {
      return 0n;
    }
  };
  const currency = String(payload.currency ?? session?.currency ?? 'COP');
  switch (kind) {
    case 'SESSION_STARTED':
      return {
        chargeBoxId: session?.charge_box_id ?? String(payload.chargeBoxId ?? ''),
        connectorId: session?.ocpp_connector_id ?? null,
      } satisfies PushVars['SESSION_STARTED'];
    case 'IDLE_STARTED': {
      let gracePeriodMin: number | null = null;
      let idlePricePerMinuteMinor: bigint | null = null;
      let idleCurrency = currency;
      if (session) {
        const snapshot = await loadSessionSnapshot(sql, session.id);
        if (snapshot) {
          const preview = previewFromSnapshot(snapshot.snapshot, {
            quoteId: '',
            validUntil: new Date(0),
            at: new Date(),
          });
          idleCurrency = preview.currency;
          if (preview.idleFee) {
            gracePeriodMin = preview.idleFee.gracePeriodMin;
            idlePricePerMinuteMinor = decimalToMinor(preview.idleFee.pricePerMinute);
          }
        }
      }
      return {
        energyWh: Number(session?.energy_wh ?? 0),
        gracePeriodMin,
        idlePricePerMinuteMinor,
        currency: idleCurrency,
      } satisfies PushVars['IDLE_STARTED'];
    }
    case 'EXPOSURE_WARNING':
      return {
        totalMinor: money(payload.totalMinor),
        limitMinor: money(payload.limitMinor),
        currency,
      } satisfies PushVars['EXPOSURE_WARNING'];
    case 'EXPOSURE_EXHAUSTED':
      return {
        limitMinor: money(payload.limitMinor),
        currency,
      } satisfies PushVars['EXPOSURE_EXHAUSTED'];
    case 'SESSION_EXPIRED':
      return {} satisfies PushVars['SESSION_EXPIRED'];
    case 'SESSION_SETTLED': {
      const summary = (payload.summary ?? {}) as { energy_wh?: number; billable_idle_s?: number };
      const calcId = typeof payload.calcId === 'string' ? payload.calcId : null;
      const lines = calcId
        ? await sql<{ dimension: string; amount: string }[]>`
            SELECT dimension, sum(amount_minor + tax_minor)::text AS amount
            FROM tariffs.session_cost_line WHERE calc_id = ${calcId} GROUP BY dimension`
        : [];
      const sum = (dimension: string): bigint =>
        money(lines.find((l) => l.dimension === dimension)?.amount ?? 0);
      return {
        energyWh: Number(summary.energy_wh ?? session?.energy_wh ?? 0),
        energyMinor: sum('ENERGY'),
        idleMinutes: Math.round(Number(summary.billable_idle_s ?? 0) / 60),
        idleMinor: sum('PARKING_TIME'),
        totalMinor: money(payload.totalMinor ?? session?.total_minor),
        currency,
      } satisfies PushVars['SESSION_SETTLED'];
    }
    case 'PAYMENT_CAPTURED': {
      const paymentId = typeof payload.paymentId === 'string' ? payload.paymentId : null;
      const payment = paymentId
        ? (await sql<PaymentRow[]>`SELECT * FROM billing.payment WHERE id = ${paymentId}`)[0]
        : undefined;
      const method = payment?.payment_method_id
        ? (
            await sql<
              PaymentMethodRow[]
            >`SELECT * FROM billing.payment_method WHERE id = ${payment.payment_method_id}`
          )[0]
        : undefined;
      const receipt = session?.receipt_id
        ? (
            await sql<
              { number: string }[]
            >`SELECT number FROM billing.invoice WHERE id = ${session.receipt_id}`
          )[0]
        : undefined;
      return {
        amountMinor: money(payload.amountMinor ?? payment?.amount_minor),
        currency,
        method: method
          ? { kind: method.kind === 'WALLET' ? 'WALLET' : 'CARD', last4: method.last4 }
          : { kind: 'UNKNOWN', last4: null },
        receiptNumber: receipt?.number ?? null,
      } satisfies PushVars['PAYMENT_CAPTURED'];
    }
    case 'PAYMENT_FAILED':
      return {
        amountMinor: money(payload.amountMinor),
        currency,
      } satisfies PushVars['PAYMENT_FAILED'];
    default:
      throw new Error(`clase no prevista: ${String(kind)}`);
  }
}

/** `"1500"` o `"12.50"` → unidad mínima según los decimales presentes (COP sin decimales). */
function decimalToMinor(value: string): bigint {
  const [integer = '0', fraction = ''] = value.split('.');
  return BigInt(`${integer}${fraction}`);
}

/** Notificaciones que quedaron PENDING (envío fallido o proceso caído) entre 1 minuto y 1 hora atrás. */
async function retryPending(sql: Sql): Promise<Outgoing[]> {
  const rows = await sql<
    { id: string; driver_id: string; title: string; body: string; data: Record<string, unknown> }[]
  >`
    SELECT id, driver_id, title, body, data FROM auth.driver_notification
    WHERE status = 'PENDING' AND created_at < now() - interval '60 seconds' AND created_at > now() - interval '1 hour'
    ORDER BY created_at LIMIT 100`;
  const outgoing: Outgoing[] = [];
  for (const row of rows) {
    const devices = await listDriverDevices(sql, row.driver_id);
    if (devices.length === 0) {
      await updateDriverNotification(sql, row.id, { status: 'NO_DEVICE' });
      continue;
    }
    for (const device of devices) {
      outgoing.push({
        notificationId: row.id,
        message: {
          to: device.push_token,
          title: row.title,
          body: row.body,
          data: { ...row.data, notificationId: row.id },
        },
      });
    }
  }
  return outgoing;
}

async function sendOutgoing(
  sql: Sql,
  sender: PushSender,
  outgoing: Outgoing[],
  logger: SchedulerLogger | undefined,
): Promise<number> {
  let tickets: PushTicket[];
  try {
    tickets = await sender.send(outgoing.map((o) => o.message));
  } catch (error) {
    // Quedan PENDING: el siguiente ciclo (pasado un minuto) las reintenta durante una hora.
    logger?.error({ err: error, messages: outgoing.length }, 'envío de notificaciones fallido');
    return 0;
  }
  const byNotification = new Map<string, { ok: number; errors: string[] }>();
  for (let i = 0; i < outgoing.length; i++) {
    const item = outgoing[i] as Outgoing;
    const ticket = tickets[i] ?? { ok: false, message: 'sin ticket' };
    const entry = byNotification.get(item.notificationId) ?? { ok: 0, errors: [] };
    if (ticket.ok) entry.ok++;
    else {
      entry.errors.push(ticket.error ? `${ticket.error}: ${ticket.message}` : ticket.message);
      if (ticket.error === 'DeviceNotRegistered') {
        await markDeviceInvalid(sql, item.message.to, 'DeviceNotRegistered');
      }
    }
    byNotification.set(item.notificationId, entry);
  }
  let sent = 0;
  for (const [id, entry] of byNotification) {
    if (entry.ok > 0) sent++;
    await updateDriverNotification(sql, id, {
      status: entry.ok > 0 ? 'SENT' : 'FAILED',
      devices: entry.ok,
      error: entry.errors.length ? entry.errors.join('; ') : null,
    });
  }
  if (sent > 0)
    logger?.info(
      { notifications: sent, messages: outgoing.length },
      'notificaciones push enviadas',
    );
  return sent;
}
