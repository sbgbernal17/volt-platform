/**
 * Editor guiado de tarifas (iteración 9, ADR 0024): convierte un formulario sencillo (precio por
 * kWh con franjas horarias, ocupación con cortesía, cargo por sesión, precio por minuto, impuesto y
 * topes) en una definición OCPI 2.2.1 con extensiones `x_volt` (TAR §7.1) y de vuelta, y resume
 * cualquier definición en frases para el operador. Módulo puro, sin React ni red.
 */
import type { Locale } from './format.ts';
import { moneyMajor } from './format.ts';

export type DayOfWeek =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';
export type PriceComponentType = 'ENERGY' | 'TIME' | 'PARKING_TIME' | 'FLAT';
export type IdleStart = 'EARLIEST' | 'TRANSACTION_END' | 'SUSPENDED_EV';
export type DayPreset = 'ALL' | 'WEEKDAYS' | 'WEEKEND';

export interface PriceComponent {
  type: PriceComponentType;
  price: string;
  vat?: string;
  step_size: number;
}

export interface TariffRestrictions {
  start_time?: string;
  end_time?: string;
  day_of_week?: DayOfWeek[];
  [key: string]: unknown;
}

export interface TariffElement {
  price_components: PriceComponent[];
  restrictions?: TariffRestrictions;
  x_volt?: { grace_period_s?: number; idle_start?: IdleStart; max_idle_s?: number };
}

export interface TariffDefinition {
  country_code: string;
  party_id: string;
  id: string;
  version?: number;
  currency: string;
  type?: string;
  tariff_alt_text?: { language: string; text: string }[];
  tariff_alt_url?: string;
  min_price?: { excl_vat: string; incl_vat?: string };
  max_price?: { excl_vat: string; incl_vat?: string };
  elements: TariffElement[];
  start_date_time?: string;
  end_date_time?: string;
  last_updated?: string;
}

export interface EnergyBand {
  /** Hora local de inicio `HH:MM` (inclusiva). */
  start: string;
  /** Hora local de fin `HH:MM` (exclusiva); si es menor que el inicio, cruza la medianoche. */
  end: string;
  price: string;
  days: DayPreset;
}

export interface TariffForm {
  /** Precio por kWh cuando ninguna franja aplica (obligatorio). */
  energyPrice: string;
  bands: EnergyBand[];
  idleEnabled: boolean;
  idlePricePerMinute: string;
  idleGraceMin: string;
  idleMaxMin: string;
  idleStart: IdleStart;
  sessionFee: string;
  timePricePerMinute: string;
  /** Porcentaje de impuesto; vacío = sin impuesto (servicio excluido de IVA). */
  vat: string;
  minPrice: string;
  maxPrice: string;
  description: string;
}

export const DAY_PRESETS: Record<DayPreset, DayOfWeek[] | undefined> = {
  ALL: undefined,
  WEEKDAYS: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
  WEEKEND: ['SATURDAY', 'SUNDAY'],
};

const DECIMAL = /^\d+(\.\d{1,6})?$/;
const BAND_RESTRICTIONS = new Set(['start_time', 'end_time', 'day_of_week']);

export class TariffFormError extends Error {
  constructor(readonly field: string) {
    super(`valor inválido en ${field}`);
    this.name = 'TariffFormError';
  }
}

export function emptyForm(): TariffForm {
  return {
    energyPrice: '',
    bands: [],
    idleEnabled: true,
    idlePricePerMinute: '1500',
    idleGraceMin: '15',
    idleMaxMin: '',
    idleStart: 'EARLIEST',
    sessionFee: '',
    timePricePerMinute: '',
    vat: '',
    minPrice: '',
    maxPrice: '',
    description: '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normaliza un decimal escrito por una persona (`1.350,5` no se admite: solo punto decimal). */
export function normalizeDecimal(value: string, field: string): string {
  const text = value.trim();
  if (!DECIMAL.test(text)) throw new TariffFormError(field);
  const [integer = '0', fraction = ''] = text.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${String(Number(integer))}${trimmed ? `.${trimmed}` : ''}`;
}

/** Multiplica un decimal en texto por un entero sin pasar por coma flotante (`12.5` × 60 = `750`). */
export function decimalTimes(value: string, factor: number): string {
  const [integer = '0', fraction = ''] = value.trim().split('.');
  const scaled = BigInt(`${integer}${fraction}`) * BigInt(factor);
  return formatScaled(scaled, fraction.length);
}

/** Divide un decimal en texto entre un entero; `null` si el resultado no es exacto en 6 decimales. */
export function decimalDivide(value: string, divisor: number): string | null {
  const [integer = '0', fraction = ''] = value.trim().split('.');
  if (fraction.length > 6) return null;
  const scaled = BigInt(`${integer}${fraction}`) * 10n ** BigInt(6 - fraction.length);
  if (scaled % BigInt(divisor) !== 0n) return null;
  return formatScaled(scaled / BigInt(divisor), 6);
}

function formatScaled(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, '0');
  const integer = scale > 0 ? digits.slice(0, -scale) : digits;
  const fraction = scale > 0 ? digits.slice(-scale).replace(/0+$/, '') : '';
  return `${integer}${fraction ? `.${fraction}` : ''}`;
}

function minutesToSeconds(value: string, field: string): number {
  const minutes = Number(value.trim());
  if (!Number.isInteger(minutes) || minutes < 0) throw new TariffFormError(field);
  return minutes * 60;
}

function dayPreset(days: unknown): DayPreset | null {
  if (days === undefined) return 'ALL';
  if (!Array.isArray(days)) return null;
  const sorted = [...days].sort().join(',');
  for (const [preset, list] of Object.entries(DAY_PRESETS)) {
    if (list && [...list].sort().join(',') === sorted) return preset as DayPreset;
  }
  return null;
}

/** Construye la definición OCPI a partir del formulario; lanza `TariffFormError` con el campo inválido. */
export function formToDefinition(
  form: TariffForm,
  meta: { code: string; currency: string; now?: Date | undefined; existing?: unknown },
): TariffDefinition {
  const vat = form.vat.trim() ? normalizeDecimal(form.vat, 'vat') : undefined;
  const component = (type: PriceComponentType, price: string, step: number): PriceComponent => ({
    type,
    price,
    ...(vat !== undefined ? { vat } : {}),
    step_size: step,
  });
  const elements: TariffElement[] = [];
  form.bands.forEach((band, index) => {
    const restrictions: TariffRestrictions = {};
    if (band.start.trim()) restrictions.start_time = band.start.trim();
    if (band.end.trim()) restrictions.end_time = band.end.trim();
    const days = DAY_PRESETS[band.days];
    if (days) restrictions.day_of_week = days;
    if (Object.keys(restrictions).length === 0) return;
    elements.push({
      price_components: [
        component('ENERGY', normalizeDecimal(band.price, `bands.${index}.price`), 1),
      ],
      restrictions,
    });
  });
  elements.push({
    price_components: [component('ENERGY', normalizeDecimal(form.energyPrice, 'energyPrice'), 1)],
  });
  if (form.timePricePerMinute.trim()) {
    elements.push({
      price_components: [
        component(
          'TIME',
          decimalTimes(normalizeDecimal(form.timePricePerMinute, 'timePricePerMinute'), 60),
          60,
        ),
      ],
    });
  }
  if (form.sessionFee.trim()) {
    elements.push({
      price_components: [component('FLAT', normalizeDecimal(form.sessionFee, 'sessionFee'), 1)],
    });
  }
  if (form.idleEnabled) {
    elements.push({
      price_components: [
        component(
          'PARKING_TIME',
          decimalTimes(normalizeDecimal(form.idlePricePerMinute, 'idlePricePerMinute'), 60),
          60,
        ),
      ],
      x_volt: {
        grace_period_s: minutesToSeconds(form.idleGraceMin, 'idleGraceMin'),
        idle_start: form.idleStart,
        ...(form.idleMaxMin.trim()
          ? { max_idle_s: minutesToSeconds(form.idleMaxMin, 'idleMaxMin') }
          : {}),
      },
    });
  }
  const previous = isRecord(meta.existing) ? meta.existing : {};
  const description = form.description.trim();
  return {
    country_code: typeof previous.country_code === 'string' ? previous.country_code : 'CO',
    party_id: typeof previous.party_id === 'string' ? previous.party_id : 'VLT',
    id: meta.code,
    currency: meta.currency,
    type: 'REGULAR',
    ...(description ? { tariff_alt_text: [{ language: 'es', text: description }] } : {}),
    ...(form.minPrice.trim()
      ? { min_price: { excl_vat: normalizeDecimal(form.minPrice, 'minPrice') } }
      : {}),
    ...(form.maxPrice.trim()
      ? { max_price: { excl_vat: normalizeDecimal(form.maxPrice, 'maxPrice') } }
      : {}),
    elements,
    last_updated: (meta.now ?? new Date()).toISOString(),
  };
}

/**
 * Lee una definición al formulario. Devuelve `null` cuando usa reglas que el formulario no cubre
 * (tramos por kWh, potencia o duración, varias componentes por elemento, precios por minuto no
 * exactos…): en ese caso la versión se edita como JSON.
 */
export function definitionToForm(input: unknown): TariffForm | null {
  if (!isRecord(input) || !Array.isArray(input.elements)) return null;
  const form = emptyForm();
  form.idleEnabled = false;
  form.idlePricePerMinute = '';
  form.idleGraceMin = '';
  let energyFallback: string | null = null;
  let vat: string | null = null;
  const bands: EnergyBand[] = [];
  for (const raw of input.elements as unknown[]) {
    if (!isRecord(raw) || !Array.isArray(raw.price_components)) return null;
    if (raw.price_components.length !== 1) return null;
    const component = raw.price_components[0] as PriceComponent;
    if (!isRecord(component) || typeof component.price !== 'string') return null;
    const componentVat = typeof component.vat === 'string' ? component.vat : '';
    if (vat === null) vat = componentVat;
    else if (vat !== componentVat) return null;
    const restrictions = isRecord(raw.restrictions) ? raw.restrictions : undefined;
    const keys = restrictions ? Object.keys(restrictions) : [];
    const xVolt = isRecord(raw.x_volt) ? (raw.x_volt as TariffElement['x_volt']) : undefined;
    switch (component.type) {
      case 'ENERGY': {
        if (keys.length === 0) {
          if (energyFallback !== null) return null;
          energyFallback = component.price;
          break;
        }
        if (energyFallback !== null || !keys.every((key) => BAND_RESTRICTIONS.has(key)))
          return null;
        const days = dayPreset(restrictions?.day_of_week);
        if (days === null) return null;
        bands.push({
          start: typeof restrictions?.start_time === 'string' ? restrictions.start_time : '',
          end: typeof restrictions?.end_time === 'string' ? restrictions.end_time : '',
          price: component.price,
          days,
        });
        break;
      }
      case 'TIME': {
        if (keys.length > 0 || form.timePricePerMinute) return null;
        const perMinute = decimalDivide(component.price, 60);
        if (perMinute === null) return null;
        form.timePricePerMinute = perMinute;
        break;
      }
      case 'FLAT': {
        if (keys.length > 0 || form.sessionFee) return null;
        form.sessionFee = component.price;
        break;
      }
      case 'PARKING_TIME': {
        if (keys.length > 0 || form.idleEnabled) return null;
        const perMinute = decimalDivide(component.price, 60);
        const grace = xVolt?.grace_period_s ?? 0;
        const max = xVolt?.max_idle_s;
        if (perMinute === null || grace % 60 !== 0 || (max !== undefined && max % 60 !== 0))
          return null;
        form.idleEnabled = true;
        form.idlePricePerMinute = perMinute;
        form.idleGraceMin = String(grace / 60);
        form.idleMaxMin = max !== undefined ? String(max / 60) : '';
        form.idleStart = xVolt?.idle_start ?? 'EARLIEST';
        break;
      }
      default:
        return null;
    }
  }
  if (energyFallback === null) return null;
  form.energyPrice = energyFallback;
  form.bands = bands;
  form.vat = vat ?? '';
  if (isRecord(input.min_price) && typeof input.min_price.excl_vat === 'string')
    form.minPrice = input.min_price.excl_vat;
  if (isRecord(input.max_price) && typeof input.max_price.excl_vat === 'string')
    form.maxPrice = input.max_price.excl_vat;
  if (Array.isArray(input.tariff_alt_text)) {
    const texts = input.tariff_alt_text.filter(isRecord);
    const chosen = texts.find((x) => x.language === 'es') ?? texts[0];
    if (chosen && typeof chosen.text === 'string') form.description = chosen.text;
  }
  return form;
}

const TEXTS = {
  es: {
    energy: 'Energía',
    band: (price: string, start: string, end: string) => `${price} de ${start} a ${end}`,
    rest: (price: string) => `resto del día ${price}`,
    weekdays: 'lunes a viernes',
    weekend: 'sábado y domingo',
    time: (price: string) => `Tiempo de carga: ${price} por minuto`,
    session: (price: string) => `Cargo por sesión: ${price}`,
    idle: (grace: number, price: string) =>
      `Ocupación: ${grace} minutos de cortesía, luego ${price} por minuto`,
    idleMax: (minutes: number) => `tope de ${minutes} minutos`,
    idleStart: {
      EARLIEST: 'desde el fin de la carga o la pausa del vehículo',
      TRANSACTION_END: 'desde el fin de la transacción',
      SUSPENDED_EV: 'desde la pausa del vehículo',
    },
    noTax: 'Sin impuesto (servicio excluido de IVA)',
    tax: (vat: string) => `IVA ${vat} %`,
    min: (price: string) => `Mínimo por sesión: ${price}`,
    max: (price: string) => `Máximo por sesión: ${price}`,
    advanced: 'Incluye reglas avanzadas (ver JSON)',
    perKwh: '/kWh',
  },
  en: {
    energy: 'Energy',
    band: (price: string, start: string, end: string) => `${price} from ${start} to ${end}`,
    rest: (price: string) => `rest of the day ${price}`,
    weekdays: 'Monday to Friday',
    weekend: 'Saturday and Sunday',
    time: (price: string) => `Charging time: ${price} per minute`,
    session: (price: string) => `Session fee: ${price}`,
    idle: (grace: number, price: string) =>
      `Idle fee: ${grace} courtesy minutes, then ${price} per minute`,
    idleMax: (minutes: number) => `capped at ${minutes} minutes`,
    idleStart: {
      EARLIEST: 'from the end of charging or the vehicle pause',
      TRANSACTION_END: 'from the end of the transaction',
      SUSPENDED_EV: 'from the vehicle pause',
    },
    noTax: 'No tax (VAT-exempt service)',
    tax: (vat: string) => `VAT ${vat} %`,
    min: (price: string) => `Minimum per session: ${price}`,
    max: (price: string) => `Maximum per session: ${price}`,
    advanced: 'Includes advanced rules (see JSON)',
    perKwh: '/kWh',
  },
} as const;

/** Frases que resumen una definición (cualquier JSON: si no se entiende, lo dice). */
export function describeTariff(input: unknown, locale: Locale = 'es'): string[] {
  const texts = TEXTS[locale];
  if (!isRecord(input) || !Array.isArray(input.elements)) return [texts.advanced];
  const currency = typeof input.currency === 'string' ? input.currency : 'COP';
  const money = (value: string) => moneyMajor(value, currency, locale);
  const lines: string[] = [];
  let advanced = false;
  const energyParts: string[] = [];
  let vat: string | null = null;
  for (const raw of input.elements as unknown[]) {
    if (!isRecord(raw) || !Array.isArray(raw.price_components)) {
      advanced = true;
      continue;
    }
    const restrictions = isRecord(raw.restrictions) ? raw.restrictions : {};
    const keys = Object.keys(restrictions);
    const simple = keys.every((key) => BAND_RESTRICTIONS.has(key));
    if (!simple) advanced = true;
    const xVolt = isRecord(raw.x_volt) ? (raw.x_volt as TariffElement['x_volt']) : undefined;
    for (const component of raw.price_components as unknown[]) {
      if (!isRecord(component) || typeof component.price !== 'string') {
        advanced = true;
        continue;
      }
      if (typeof component.vat === 'string') vat = component.vat;
      const days = dayPreset(restrictions.day_of_week);
      const daysText =
        days === 'WEEKDAYS'
          ? ` (${texts.weekdays})`
          : days === 'WEEKEND'
            ? ` (${texts.weekend})`
            : '';
      switch (component.type) {
        case 'ENERGY': {
          const price = `${money(component.price)}${texts.perKwh}`;
          const start = restrictions.start_time;
          const end = restrictions.end_time;
          if (typeof start === 'string' && typeof end === 'string')
            energyParts.push(`${texts.band(price, start, end)}${daysText}`);
          else if (keys.length === 0)
            energyParts.push(energyParts.length ? texts.rest(price) : price);
          else energyParts.push(`${price}${daysText}`);
          break;
        }
        case 'TIME': {
          const perMinute =
            decimalDivide(component.price, 60) ?? (Number(component.price) / 60).toFixed(2);
          lines.push(texts.time(money(perMinute)));
          break;
        }
        case 'FLAT':
          lines.push(texts.session(money(component.price)));
          break;
        case 'PARKING_TIME': {
          const perMinute =
            decimalDivide(component.price, 60) ?? (Number(component.price) / 60).toFixed(2);
          const grace = Math.round((xVolt?.grace_period_s ?? 0) / 60);
          const start = xVolt?.idle_start ?? 'EARLIEST';
          const max = xVolt?.max_idle_s;
          lines.push(
            `${texts.idle(grace, money(perMinute))}${max !== undefined ? `, ${texts.idleMax(Math.round(max / 60))}` : ''}, ${texts.idleStart[start] ?? texts.idleStart.EARLIEST}`,
          );
          break;
        }
        default:
          advanced = true;
      }
    }
  }
  if (energyParts.length) lines.unshift(`${texts.energy}: ${energyParts.join('; ')}`);
  lines.push(vat && Number(vat) > 0 ? texts.tax(vat) : texts.noTax);
  if (isRecord(input.min_price) && typeof input.min_price.excl_vat === 'string')
    lines.push(texts.min(money(input.min_price.excl_vat)));
  if (isRecord(input.max_price) && typeof input.max_price.excl_vat === 'string')
    lines.push(texts.max(money(input.max_price.excl_vat)));
  if (advanced) lines.push(texts.advanced);
  return lines;
}
