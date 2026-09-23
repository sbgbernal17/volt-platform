/**
 * Textos de las notificaciones push al conductor (docs/textos-app-conductor.md, voz del manual de
 * marca: trato de usted, frases cortas, sin exclamaciones, cifras en formato colombiano). Función
 * pura: el worker la alimenta con los datos del evento y de la sesión.
 */
import type { DriverLocale } from './identity.ts';

export const PUSH_KINDS = [
  'SESSION_STARTED',
  'IDLE_STARTED',
  'EXPOSURE_WARNING',
  'EXPOSURE_EXHAUSTED',
  'SESSION_EXPIRED',
  'SESSION_SETTLED',
  'PAYMENT_CAPTURED',
  'PAYMENT_FAILED',
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

export function isPushKind(value: unknown): value is PushKind {
  return typeof value === 'string' && (PUSH_KINDS as readonly string[]).includes(value);
}

export interface PushVars {
  SESSION_STARTED: { chargeBoxId: string; connectorId: number | null };
  IDLE_STARTED: {
    energyWh: number;
    gracePeriodMin: number | null;
    idlePricePerMinuteMinor: bigint | null;
    currency: string;
  };
  EXPOSURE_WARNING: { totalMinor: bigint; limitMinor: bigint; currency: string };
  EXPOSURE_EXHAUSTED: { limitMinor: bigint; currency: string };
  SESSION_EXPIRED: Record<string, never>;
  SESSION_SETTLED: {
    energyWh: number;
    energyMinor: bigint;
    idleMinutes: number;
    idleMinor: bigint;
    totalMinor: bigint;
    currency: string;
  };
  PAYMENT_CAPTURED: {
    amountMinor: bigint;
    currency: string;
    /** `card` con `last4`, `wallet` (Nequi) o desconocido. */
    method: { kind: 'CARD' | 'WALLET' | 'UNKNOWN'; last4: string | null };
    receiptNumber: string | null;
  };
  PAYMENT_FAILED: { amountMinor: bigint; currency: string };
}

export interface PushText {
  title: string;
  body: string;
}

const EXPONENTS: Record<string, number> = { COP: 0, USD: 2, EUR: 2 };

/** Importe en formato colombiano: `$ 48.240` (COP) o `USD 12,50`. */
export function formatMoney(minor: bigint | number | string, currency = 'COP'): string {
  const exponent = EXPONENTS[currency] ?? 2;
  let value = BigInt(minor);
  const negative = value < 0n;
  if (negative) value = -value;
  const digits = value.toString().padStart(exponent + 1, '0');
  const integer = exponent > 0 ? digits.slice(0, -exponent) : digits;
  const fraction = exponent > 0 ? digits.slice(-exponent) : '';
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const number = fraction ? `${grouped},${fraction}` : grouped;
  const prefix = currency === 'COP' ? '$ ' : `${currency} `;
  return `${negative ? '-' : ''}${prefix}${number}`;
}

/** Energía en kWh con una decimal y coma: `22,4 kWh`, `22 kWh`. */
export function formatKwh(wh: number): string {
  const tenths = Math.round(wh / 100);
  const integer = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  const grouped = integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal === 0 ? `${grouped} kWh` : `${grouped},${decimal} kWh`;
}

function minutes(locale: DriverLocale, value: number): string {
  if (locale === 'en') return value === 1 ? '1 minute' : `${value} minutes`;
  return value === 1 ? '1 minuto' : `${value} minutos`;
}

export function buildPushText<K extends PushKind>(
  kind: K,
  locale: DriverLocale,
  vars: PushVars[K],
): PushText {
  const en = locale === 'en';
  switch (kind) {
    case 'SESSION_STARTED': {
      const v = vars as PushVars['SESSION_STARTED'];
      const where =
        v.connectorId === null
          ? en
            ? `charger ${v.chargeBoxId}`
            : `el cargador ${v.chargeBoxId}`
          : en
            ? `charger ${v.chargeBoxId}, connector ${v.connectorId}`
            : `el cargador ${v.chargeBoxId}, conector ${v.connectorId}`;
      return en
        ? {
            title: 'Charging started',
            body: `Your vehicle started charging at ${where}. Follow the progress in the app.`,
          }
        : {
            title: 'Carga iniciada',
            body: `Su vehículo empezó a cargar en ${where}. Siga el progreso en la app.`,
          };
    }
    case 'IDLE_STARTED': {
      const v = vars as PushVars['IDLE_STARTED'];
      const energy = formatKwh(v.energyWh);
      if (v.gracePeriodMin === null || v.idlePricePerMinuteMinor === null) {
        return en
          ? {
              title: 'Your vehicle stopped charging',
              body: `${energy} charged. Unplug your vehicle to free the charger.`,
            }
          : {
              title: 'Su vehículo dejó de cargar',
              body: `${energy} cargados. Desconecte el vehículo para liberar el cargador.`,
            };
      }
      const price = formatMoney(v.idlePricePerMinuteMinor, v.currency);
      return en
        ? {
            title: 'Your vehicle stopped charging',
            body: `${energy} charged. You have ${minutes('en', v.gracePeriodMin)} of courtesy to unplug your vehicle. After that, idle time costs ${price} per minute.`,
          }
        : {
            title: 'Su vehículo dejó de cargar',
            body: `${energy} cargados. Tiene ${minutes('es', v.gracePeriodMin)} de cortesía para desconectar el vehículo. Después se cobra ocupación de ${price} por minuto.`,
          };
    }
    case 'EXPOSURE_WARNING': {
      const v = vars as PushVars['EXPOSURE_WARNING'];
      const total = formatMoney(v.totalMinor, v.currency);
      const limit = formatMoney(v.limitMinor, v.currency);
      return en
        ? {
            title: 'Session limit warning',
            body: `This session is at ${total} of a ${limit} limit. Charging stops automatically at the limit; you can start another session.`,
          }
        : {
            title: 'Aviso del límite por sesión',
            body: `Esta sesión va en ${total} de un límite de ${limit}. Al llegar al límite la carga se detendrá sola; puede iniciar otra sesión.`,
          };
    }
    case 'EXPOSURE_EXHAUSTED': {
      const v = vars as PushVars['EXPOSURE_EXHAUSTED'];
      const limit = formatMoney(v.limitMinor, v.currency);
      return en
        ? {
            title: 'Charging stopped at the limit',
            body: `Charging stopped at this session's ${limit} limit. You can start a new session.`,
          }
        : {
            title: 'Carga detenida por el límite',
            body: `La carga se detuvo al llegar al límite de ${limit} de esta sesión. Puede iniciar una nueva carga.`,
          };
    }
    case 'SESSION_EXPIRED':
      return en
        ? {
            title: 'Charging did not start',
            body: 'We did not detect the vehicle. Plug in the cable and start again.',
          }
        : {
            title: 'La carga no inició',
            body: 'No detectamos el vehículo. Conecte el cable y vuelva a iniciar.',
          };
    case 'SESSION_SETTLED': {
      const v = vars as PushVars['SESSION_SETTLED'];
      const energy = `${formatKwh(v.energyWh)}, ${formatMoney(v.energyMinor, v.currency)}`;
      const idle =
        v.idleMinutes > 0
          ? en
            ? ` Idle: ${minutes('en', v.idleMinutes)}, ${formatMoney(v.idleMinor, v.currency)}.`
            : ` Ocupación: ${minutes('es', v.idleMinutes)}, ${formatMoney(v.idleMinor, v.currency)}.`
          : '';
      const total = formatMoney(v.totalMinor, v.currency);
      return en
        ? { title: 'Session ended', body: `Energy: ${energy}.${idle} Total: ${total}.` }
        : { title: 'Sesión terminada', body: `Energía: ${energy}.${idle} Total: ${total}.` };
    }
    case 'PAYMENT_CAPTURED': {
      const v = vars as PushVars['PAYMENT_CAPTURED'];
      const amount = formatMoney(v.amountMinor, v.currency);
      const method =
        v.method.kind === 'CARD' && v.method.last4
          ? en
            ? `to the card ending in ${v.method.last4}`
            : `a la tarjeta terminada en ${v.method.last4}`
          : v.method.kind === 'WALLET'
            ? en
              ? 'to your Nequi account'
              : 'a su cuenta Nequi'
            : en
              ? 'to your payment method'
              : 'a su medio de pago';
      const receipt = v.receiptNumber
        ? en
          ? ` Receipt No. ${v.receiptNumber} is available under History.`
          : ` Recibo N.º ${v.receiptNumber} disponible en Historial.`
        : '';
      return en
        ? { title: 'Payment approved', body: `Payment approved: ${amount} ${method}.${receipt}` }
        : { title: 'Cobro aprobado', body: `Cobro aprobado: ${amount} ${method}.${receipt}` };
    }
    case 'PAYMENT_FAILED': {
      const v = vars as PushVars['PAYMENT_FAILED'];
      const amount = formatMoney(v.amountMinor, v.currency);
      return en
        ? {
            title: 'Payment declined',
            body: `We could not charge ${amount} to your payment method. Update it or pay the link to charge again.`,
          }
        : {
            title: 'Cobro rechazado',
            body: `No pudimos cobrar ${amount} a su medio de pago. Actualícelo o pague el enlace para volver a cargar.`,
          };
    }
    default:
      throw new Error(`clase de notificación desconocida: ${String(kind)}`);
  }
}
