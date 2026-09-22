/**
 * Validación de definiciones de tarifa (OCPI 2.2.1 + `x_volt`) según TAR §7.4: esquema estricto y
 * reglas de negocio (elemento de respaldo por dimensión, elementos inalcanzables, gracia obligatoria
 * con PARKING_TIME, topes coherentes). Fail-closed: una tarifa que no valida no se publica.
 */
import type { PriceComponentType, Tariff } from '@volt/tariff-engine';
import { z } from 'zod';
import { ValidationError } from '../errors.ts';

const decimal = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, 'número decimal sin signo con hasta 6 decimales');
const vat = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/, 'porcentaje con hasta 3 decimales');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora local HH:MM');
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha YYYY-MM-DD');
const nonNegative = z.number().min(0);
const nonNegativeInt = z.number().int().min(0);

export const DAYS_OF_WEEK = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

const priceComponentSchema = z
  .object({
    type: z.enum(['ENERGY', 'TIME', 'PARKING_TIME', 'FLAT']),
    price: decimal,
    vat: vat.optional(),
    step_size: z.number().int().min(1),
  })
  .strict();

const restrictionsSchema = z
  .object({
    start_time: hhmm.optional(),
    end_time: hhmm.optional(),
    start_date: dateKey.optional(),
    end_date: dateKey.optional(),
    min_kwh: nonNegative.optional(),
    max_kwh: nonNegative.optional(),
    min_current: nonNegative.optional(),
    max_current: nonNegative.optional(),
    min_power: nonNegative.optional(),
    max_power: nonNegative.optional(),
    min_duration: nonNegativeInt.optional(),
    max_duration: nonNegativeInt.optional(),
    day_of_week: z.array(z.enum(DAYS_OF_WEEK)).min(1).optional(),
    reservation: z.enum(['RESERVATION', 'RESERVATION_EXPIRES']).optional(),
  })
  .strict();

const xVoltSchema = z
  .object({
    grace_period_s: nonNegativeInt.optional(),
    idle_start: z.enum(['TRANSACTION_END', 'SUSPENDED_EV', 'EARLIEST']).optional(),
    max_idle_s: nonNegativeInt.optional(),
  })
  .strict();

const elementSchema = z
  .object({
    price_components: z.array(priceComponentSchema).min(1),
    restrictions: restrictionsSchema.optional(),
    x_volt: xVoltSchema.optional(),
  })
  .strict();

const priceSchema = z.object({ excl_vat: decimal, incl_vat: decimal.optional() }).strict();

export const tariffDefinitionSchema = z
  .object({
    country_code: z.string().regex(/^[A-Z]{2}$/),
    party_id: z.string().regex(/^[A-Z0-9]{3}$/),
    id: z.string().min(1).max(36),
    version: z.number().int().min(1).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    type: z
      .enum(['AD_HOC_PAYMENT', 'PROFILE_CHEAP', 'PROFILE_FAST', 'PROFILE_GREEN', 'REGULAR'])
      .optional(),
    tariff_alt_text: z
      .array(
        z.object({ language: z.string().min(2).max(8), text: z.string().min(1).max(512) }).strict(),
      )
      .optional(),
    tariff_alt_url: z.string().url().optional(),
    min_price: priceSchema.optional(),
    max_price: priceSchema.optional(),
    elements: z.array(elementSchema).min(1),
    start_date_time: z.string().datetime({ offset: true }).optional(),
    end_date_time: z.string().datetime({ offset: true }).optional(),
    last_updated: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type TariffDefinitionInput = z.input<typeof tariffDefinitionSchema>;

export interface TariffValidation {
  definition: Tariff;
  dimensions: PriceComponentType[];
  warnings: string[];
}

const DIMENSIONS: PriceComponentType[] = ['ENERGY', 'TIME', 'PARKING_TIME', 'FLAT'];
const FALLBACK_REQUIRED: PriceComponentType[] = ['ENERGY', 'TIME'];

/** Valida esquema y reglas; lanza `ValidationError` con la lista de problemas. */
export function validateTariffDefinition(input: unknown): TariffValidation {
  const parsed = tariffDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      'La definición de tarifa no cumple el esquema OCPI',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  const def = parsed.data;
  const problems: string[] = [];
  const warnings: string[] = [];
  const dimensions = new Set<PriceComponentType>();

  def.elements.forEach((element, index) => {
    const types = element.price_components.map((c) => c.type);
    for (const type of types) dimensions.add(type);
    if (new Set(types).size !== types.length) {
      problems.push(`elemento ${index}: dimensión repetida dentro del mismo elemento`);
    }
    const r = element.restrictions;
    if (r) {
      if (Object.keys(r).length === 0)
        problems.push(`elemento ${index}: restrictions vacío (omítelo)`);
      if (r.min_kwh !== undefined && r.max_kwh !== undefined && r.min_kwh >= r.max_kwh)
        problems.push(`elemento ${index}: min_kwh debe ser menor que max_kwh`);
      if (r.min_power !== undefined && r.max_power !== undefined && r.min_power >= r.max_power)
        problems.push(`elemento ${index}: min_power debe ser menor que max_power`);
      if (
        r.min_duration !== undefined &&
        r.max_duration !== undefined &&
        r.min_duration >= r.max_duration
      )
        problems.push(`elemento ${index}: min_duration debe ser menor que max_duration`);
      if (r.start_date !== undefined && r.end_date !== undefined && r.start_date >= r.end_date)
        problems.push(`elemento ${index}: start_date debe ser anterior a end_date`);
      if (r.start_time !== undefined && r.end_time !== undefined && r.start_time === r.end_time)
        warnings.push(`elemento ${index}: start_time = end_time se interpreta como todo el día`);
      if (r.min_current !== undefined || r.max_current !== undefined)
        warnings.push(
          `elemento ${index}: las restricciones de corriente no se pueden evaluar en OCPP 1.6 (el elemento nunca aplica)`,
        );
      if (r.reservation !== undefined)
        warnings.push(
          `elemento ${index}: las reservas llegan en una iteración posterior (el elemento nunca aplica)`,
        );
    }
    if (types.includes('PARKING_TIME') && element.x_volt?.grace_period_s === undefined) {
      problems.push(
        `elemento ${index}: x_volt.grace_period_s es obligatorio en un elemento PARKING_TIME`,
      );
    }
    if (element.x_volt && !types.includes('PARKING_TIME')) {
      warnings.push(`elemento ${index}: x_volt solo tiene efecto en elementos PARKING_TIME`);
    }
  });

  for (const dimension of DIMENSIONS) {
    const indices = def.elements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => element.price_components.some((c) => c.type === dimension));
    if (indices.length === 0) continue;
    const firstUnrestricted = indices.findIndex(({ element }) => !element.restrictions);
    if (firstUnrestricted < 0) {
      if (FALLBACK_REQUIRED.includes(dimension)) {
        problems.push(`${dimension}: falta el elemento de respaldo sin restricciones al final`);
      } else {
        warnings.push(`${dimension}: sin elemento de respaldo; fuera de las franjas no se cobra`);
      }
    } else if (firstUnrestricted < indices.length - 1) {
      const unreachable = indices.slice(firstUnrestricted + 1).map(({ index }) => index);
      problems.push(
        `${dimension}: los elementos ${unreachable.join(', ')} son inalcanzables (van tras el de respaldo)`,
      );
    }
  }

  const checkPrice = (
    label: string,
    price: { excl_vat: string; incl_vat?: string | undefined } | undefined,
  ) => {
    if (price?.incl_vat !== undefined && Number(price.incl_vat) < Number(price.excl_vat))
      problems.push(`${label}: incl_vat no puede ser menor que excl_vat`);
  };
  checkPrice('max_price', def.max_price);
  checkPrice('min_price', def.min_price);
  if (
    def.max_price &&
    def.min_price &&
    Number(def.max_price.excl_vat) < Number(def.min_price.excl_vat)
  ) {
    problems.push('max_price debe ser mayor o igual que min_price');
  }
  if (def.start_date_time && def.end_date_time && def.start_date_time >= def.end_date_time) {
    problems.push('start_date_time debe ser anterior a end_date_time');
  }

  if (problems.length > 0) {
    throw new ValidationError('La definición de tarifa no cumple las reglas de TAR §7.4', problems);
  }
  return {
    definition: { ...def, last_updated: def.last_updated ?? new Date(0).toISOString() } as Tariff,
    dimensions: DIMENSIONS.filter((d) => dimensions.has(d)),
    warnings,
  };
}

export const adjustmentSchema = z
  .object({
    type: z.enum(['PERCENT', 'AMOUNT']),
    dimension: z.enum(['ENERGY', 'TIME', 'PARKING_TIME', 'FLAT']).optional(),
    value: z.string().regex(/^-?\d+(\.\d{1,6})?$/, 'número decimal con signo'),
    label: z.string().min(1).max(120).optional(),
  })
  .strict();

export const adjustmentsSchema = z.array(adjustmentSchema).max(20);

export const SEGMENT_PATTERN =
  /^(PUBLIC|ADHOC|EMPLOYEE|INTERNAL|MEMBER:[A-Z0-9_-]{1,32}|FLEET:[A-Z0-9_-]{1,64}|ROAMING:[A-Z0-9_-]{1,32})$/;

export const segmentSchema = z.string().regex(SEGMENT_PATTERN, 'segmento inválido');
