/**
 * Snapshot inmutable de tarifa por sesión (TAR §2.5) y cotización previa (TAR §1.3): todo lo que el
 * motor necesita (tarifa, política, ajustes, impuestos, límite de exposición) queda congelado al
 * autorizar la sesión, con hash, y nunca se modifica.
 */
import { randomUUID } from 'node:crypto';
import {
  divideRounded,
  formatScaled,
  PRICE_SCALE,
  PRICE_SCALE_FACTOR,
  parseScaled,
  type RoundingMode,
} from '@volt/domain';
import {
  type Adjustment,
  activeComponent,
  type CostPolicy,
  canonicalJson,
  ENGINE_VERSION,
  sha256Hex,
  type Tariff,
} from '@volt/tariff-engine';
import type { ISql } from 'postgres';
import { NotFoundError, ValidationError } from '../errors.ts';
import { getEvseByCode, getEvseById } from '../sessions/locations.ts';
import type { ChargingSessionRow } from '../sessions/rows.ts';
import { toJson } from '../types.ts';
import { type ResolutionCandidate, resolveTariff, type TariffResolution } from './assignments.ts';
import { resolveParam } from './params.ts';

/** Exponente operativo por moneda (ADR 0017: COP se opera en pesos enteros). */
export const CURRENCY_EXPONENTS: Record<string, number> = {
  COP: 0,
  CLP: 0,
  PYG: 0,
  JPY: 0,
  KRW: 0,
  USD: 2,
  EUR: 2,
  MXN: 2,
  PEN: 2,
  BRL: 2,
  ARS: 2,
  GBP: 2,
};

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENTS[currency] ?? 2;
}

export interface TariffSnapshot {
  version: 1;
  segment: string;
  /** `null` para el segmento INTERNAL (costo cero). */
  tariff: Tariff | null;
  policy: CostPolicy;
  tax_included: boolean;
  adjustments: Adjustment[];
  /** Texto para no perder precisión en JSON. */
  exposure_limit_minor: string | null;
  warn_pct: number;
  tariff_version_id: string | null;
  tariff_code: string | null;
  tariff_version: number | null;
  assignment_id: string | null;
  evse_id: string;
  evse_code: string;
  resolved_at: string;
  candidates: ResolutionCandidate[];
  engine_version: string;
}

export interface SnapshotRow {
  session_id: string;
  quote_id: string | null;
  tariff_version_id: string | null;
  segment: string;
  snapshot: TariffSnapshot;
  snapshot_hash: string;
  applied_rules: unknown[];
  retro: boolean;
  frozen_at: Date;
}

export interface PricingPolicy {
  policy: CostPolicy;
  taxIncluded: boolean;
  warnPct: number;
  exposureLimitMinor: bigint | null;
}

/** Política de cálculo a partir de los parámetros configurables y la zona horaria de la sede. */
export async function loadPricingPolicy(
  db: ISql,
  input: {
    tenantId: string;
    connectorId?: string | null | undefined;
    siteId: string;
    currency: string;
    taxIncluded?: boolean | undefined;
  },
): Promise<PricingPolicy> {
  const site = await db<
    { timezone: string }[]
  >`SELECT timezone FROM assets.site WHERE id = ${input.siteId}`;
  const timezone = site[0]?.timezone ?? 'America/Bogota';
  const scope = { tenantId: input.tenantId, connectorId: input.connectorId };
  const rounding = await resolveParam<RoundingMode>(db, 'pricing.rounding', scope);
  const taxRounding = await resolveParam<'PER_LINE' | 'PER_TAX_GROUP'>(
    db,
    'pricing.tax_rounding',
    scope,
  );
  const warnPct = await resolveParam<number>(db, 'pricing.warn_pct', scope);
  const exposure = await resolveParam<number>(db, 'pricing.exposure_limit_minor', scope);
  const taxIncluded =
    input.taxIncluded ?? (await resolveParam<boolean>(db, 'pricing.tax_included', scope));
  return {
    policy: {
      rounding,
      tax_rounding: taxRounding,
      currency_exponent: currencyExponent(input.currency),
      timezone,
    },
    taxIncluded,
    warnPct,
    exposureLimitMinor: exposure > 0 ? BigInt(exposure) : null,
  };
}

export function buildSnapshot(
  resolution: TariffResolution,
  pricing: PricingPolicy,
  exposureLimitMinor: bigint | null,
): { snapshot: TariffSnapshot; hash: string } {
  const base = {
    version: 1 as const,
    policy: pricing.policy,
    tax_included: pricing.taxIncluded,
    exposure_limit_minor: exposureLimitMinor === null ? null : exposureLimitMinor.toString(),
    warn_pct: pricing.warnPct,
    evse_id: resolution.evse.evse_uuid,
    evse_code: resolution.evse.evse_code,
    resolved_at: resolution.at.toISOString(),
    candidates: resolution.candidates,
    engine_version: ENGINE_VERSION,
  };
  const snapshot: TariffSnapshot =
    resolution.kind === 'INTERNAL'
      ? {
          ...base,
          segment: 'INTERNAL',
          tariff: null,
          adjustments: [],
          tariff_version_id: null,
          tariff_code: null,
          tariff_version: null,
          assignment_id: null,
          exposure_limit_minor: null,
        }
      : {
          ...base,
          segment: resolution.segmentUsed,
          tariff: resolution.version.definition,
          adjustments: resolution.adjustments,
          tax_included: resolution.version.tax_included,
          tariff_version_id: resolution.version.id,
          tariff_code: resolution.tariff.code,
          tariff_version: resolution.version.version,
          assignment_id: resolution.assignment.id,
        };
  return { snapshot, hash: sha256Hex(canonicalJson(snapshot)) };
}

export interface FreezeSnapshotInput {
  session: ChargingSessionRow;
  segment: string;
  quoteId?: string | null | undefined;
  retro?: boolean | undefined;
  at?: Date | undefined;
}

/**
 * Congela el snapshot de una sesión al autorizarla (o retroactivamente para una sesión no
 * solicitada). Lanza `NoTariffError` si no hay tarifa vigente: la sesión no arranca sin precio.
 */
export async function freezeSessionSnapshot(
  db: ISql,
  input: FreezeSnapshotInput,
): Promise<SnapshotRow> {
  const existing = await loadSessionSnapshot(db, input.session.id);
  if (existing) return existing;
  const at = input.at ?? new Date();
  let built: { snapshot: TariffSnapshot; hash: string } | undefined;
  let quoteId: string | null = null;
  if (input.quoteId) {
    const quote = await getQuote(db, input.quoteId);
    if (
      quote &&
      quote.evse_id === input.session.evse_id &&
      quote.segment === input.segment &&
      quote.valid_until.getTime() >= at.getTime()
    ) {
      built = { snapshot: quote.snapshot, hash: quote.snapshot_hash };
      quoteId = quote.id;
    }
  }
  if (!built) {
    const resolution = await resolveTariff(db, {
      tenantId: input.session.tenant_id,
      evseId: input.session.evse_id,
      segment: input.segment,
      at,
    });
    const currency = resolution.kind === 'TARIFF' ? resolution.tariff.currency : 'COP';
    const pricing = await loadPricingPolicy(db, {
      tenantId: input.session.tenant_id,
      connectorId: input.session.connector_id ?? resolution.evse.connector_uuid,
      siteId: input.session.site_id,
      currency,
      taxIncluded: resolution.kind === 'TARIFF' ? resolution.version.tax_included : undefined,
    });
    built = buildSnapshot(
      resolution,
      pricing,
      effectiveExposureLimit(pricing.exposureLimitMinor, input.session.preauth_minor),
    );
  }
  const rows = await db<SnapshotRow[]>`
    INSERT INTO tariffs.session_tariff_snapshot
      (session_id, quote_id, tariff_version_id, segment, snapshot, snapshot_hash, retro, frozen_at)
    VALUES (${input.session.id}, ${quoteId}, ${built.snapshot.tariff_version_id}, ${built.snapshot.segment},
            ${toJson(db as never, built.snapshot)}, ${built.hash}, ${input.retro ?? false}, ${at})
    RETURNING *`;
  const row = rows[0] as SnapshotRow;
  await db`
    UPDATE sessions.charging_session SET
      tariff_snapshot_id = ${row.session_id}, tariff_segment = ${row.segment},
      currency = ${built.snapshot.tariff?.currency ?? 'COP'},
      exposure_limit_minor = ${built.snapshot.exposure_limit_minor}::bigint,
      anomaly_flags = CASE WHEN ${input.retro ?? false} AND NOT ('RETRO_SNAPSHOT' = ANY(anomaly_flags))
                           THEN array_append(anomaly_flags, 'RETRO_SNAPSHOT') ELSE anomaly_flags END,
      updated_at = now()
    WHERE id = ${input.session.id}`;
  return row;
}

/** El límite aplicable es el menor entre el parámetro y la preautorización de pago (si existe). */
export function effectiveExposureLimit(
  paramLimit: bigint | null,
  preauth: bigint | null | undefined,
): bigint | null {
  const hold = preauth === null || preauth === undefined ? null : BigInt(preauth);
  if (paramLimit === null) return hold;
  if (hold === null) return paramLimit;
  return hold < paramLimit ? hold : paramLimit;
}

export async function loadSessionSnapshot(
  db: ISql,
  sessionId: string,
): Promise<SnapshotRow | undefined> {
  const rows = await db<
    SnapshotRow[]
  >`SELECT * FROM tariffs.session_tariff_snapshot WHERE session_id = ${sessionId}`;
  return rows[0];
}

// ---- cotización ----

export interface QuoteRow {
  id: string;
  tenant_id: string;
  evse_id: string;
  segment: string;
  driver_id: string | null;
  computed_at: Date;
  valid_until: Date;
  snapshot: TariffSnapshot;
  snapshot_hash: string;
}

export async function getQuote(db: ISql, id: string): Promise<QuoteRow | undefined> {
  const rows = await db<QuoteRow[]>`SELECT * FROM tariffs.price_quote WHERE id = ${id}`;
  return rows[0];
}

export interface EnergyElementPreview {
  startTime: string | null;
  endTime: string | null;
  days: string[] | null;
  pricePerKwh: string;
  label: string;
}

/** Vista de la tarifa para la app (ARQ §1.4): precios al consumidor, ocupación y gracia. */
export interface TariffPreview {
  quoteId: string;
  validUntil: string;
  currency: string;
  taxIncluded: boolean;
  segment: string;
  tariffCode: string | null;
  tariffVersion: number | null;
  energy: { pricePerKwhNow: string | null; elements: EnergyElementPreview[] };
  sessionFee: string | null;
  timeFee: { pricePerMinute: string } | null;
  idleFee: {
    pricePerMinute: string;
    gracePeriodMin: number;
    maxIdleMin: number | null;
    startsAt: 'TRANSACTION_END' | 'SUSPENDED_EV' | 'EARLIEST';
  } | null;
  maxPrice: string | null;
  minPrice: string | null;
  exposureLimit: string | null;
  adjustments: Adjustment[];
  text: string | null;
}

export interface QuoteInput {
  tenantId: string;
  evseCode?: string | undefined;
  evseId?: string | undefined;
  segment: string;
  driverId?: string | null | undefined;
  at?: Date | undefined;
  language?: string | undefined;
}

/** Cotiza el EVSE para un segmento: resuelve, congela un snapshot temporal y devuelve la vista pública. */
export async function quoteEvse(db: ISql, input: QuoteInput): Promise<TariffPreview> {
  const at = input.at ?? new Date();
  const evse = input.evseCode
    ? await getEvseByCode(db, input.tenantId, input.evseCode)
    : input.evseId
      ? await getEvseById(db, input.evseId)
      : undefined;
  if (!evse) throw new ValidationError('Hace falta evseCode o evseId');
  const resolution = await resolveTariff(db, {
    tenantId: input.tenantId,
    evseId: evse.evse_uuid,
    segment: input.segment,
    at,
  });
  const currency = resolution.kind === 'TARIFF' ? resolution.tariff.currency : 'COP';
  const pricing = await loadPricingPolicy(db, {
    tenantId: input.tenantId,
    connectorId: evse.connector_uuid,
    siteId: evse.site_id,
    currency,
    taxIncluded: resolution.kind === 'TARIFF' ? resolution.version.tax_included : undefined,
  });
  const { snapshot, hash } = buildSnapshot(resolution, pricing, pricing.exposureLimitMinor);
  const validityMin = await resolveParam<number>(db, 'pricing.quote_validity_min', {
    tenantId: input.tenantId,
  });
  const validUntil = new Date(at.getTime() + validityMin * 60_000);
  const id = randomUUID();
  await db`
    INSERT INTO tariffs.price_quote (id, tenant_id, evse_id, segment, driver_id, computed_at, valid_until, snapshot, snapshot_hash)
    VALUES (${id}, ${input.tenantId}, ${evse.evse_uuid}, ${snapshot.segment}, ${input.driverId ?? null}, ${at}, ${validUntil},
            ${toJson(db as never, snapshot)}, ${hash})`;
  return previewFromSnapshot(snapshot, {
    quoteId: id,
    validUntil,
    at,
    language: input.language ?? 'es',
  });
}

export function previewFromSnapshot(
  snapshot: TariffSnapshot,
  meta: { quoteId: string; validUntil: Date; at: Date; language?: string | undefined },
): TariffPreview {
  const tariff = snapshot.tariff;
  const exponent = snapshot.policy.currency_exponent;
  const currency = tariff?.currency ?? 'COP';
  const consumer = (price: string, vat: string | undefined): string => {
    const scaled = parseScaled(price, PRICE_SCALE);
    const gross = snapshot.tax_included
      ? scaled
      : divideRounded(
          scaled * (100_000n + parseScaled(vat ?? '0', 3)),
          100_000n,
          snapshot.policy.rounding,
        );
    return formatScaled(
      divideRounded(gross * 10n ** BigInt(exponent), PRICE_SCALE_FACTOR, snapshot.policy.rounding),
      exponent,
    );
  };
  const perMinute = (price: string, vat: string | undefined): string => {
    const scaled = parseScaled(price, PRICE_SCALE);
    const gross = snapshot.tax_included
      ? scaled
      : divideRounded(
          scaled * (100_000n + parseScaled(vat ?? '0', 3)),
          100_000n,
          snapshot.policy.rounding,
        );
    return formatScaled(
      divideRounded(
        gross * 10n ** BigInt(exponent),
        60n * PRICE_SCALE_FACTOR,
        snapshot.policy.rounding,
      ),
      exponent,
    );
  };
  const base: TariffPreview = {
    quoteId: meta.quoteId,
    validUntil: meta.validUntil.toISOString(),
    currency,
    taxIncluded: snapshot.tax_included,
    segment: snapshot.segment,
    tariffCode: snapshot.tariff_code,
    tariffVersion: snapshot.tariff_version,
    energy: { pricePerKwhNow: null, elements: [] },
    sessionFee: null,
    timeFee: null,
    idleFee: null,
    maxPrice: null,
    minPrice: null,
    exposureLimit:
      snapshot.exposure_limit_minor === null
        ? null
        : formatScaled(BigInt(snapshot.exposure_limit_minor), exponent),
    adjustments: snapshot.adjustments,
    text: null,
  };
  if (!tariff) return base;
  const now = activeComponent(tariff, 'ENERGY', meta.at, snapshot.policy.timezone);
  base.energy.pricePerKwhNow = now ? consumer(now.component.price, now.component.vat) : null;
  tariff.elements.forEach((element, index) => {
    const energy = element.price_components.find((c) => c.type === 'ENERGY');
    if (energy) {
      const r = element.restrictions;
      base.energy.elements.push({
        startTime: r?.start_time ?? null,
        endTime: r?.end_time ?? null,
        days: r?.day_of_week ?? null,
        pricePerKwh: consumer(energy.price, energy.vat),
        label: r
          ? `e${index}: ${r.start_time ?? '00:00'}-${r.end_time ?? '24:00'}${r.day_of_week ? ` ${r.day_of_week.map((d) => d.slice(0, 3)).join(',')}` : ''}`
          : `e${index}: resto`,
      });
    }
    const flat = element.price_components.find((c) => c.type === 'FLAT');
    if (flat && base.sessionFee === null) base.sessionFee = consumer(flat.price, flat.vat);
    const time = element.price_components.find((c) => c.type === 'TIME');
    if (time && base.timeFee === null)
      base.timeFee = { pricePerMinute: perMinute(time.price, time.vat) };
    const parking = element.price_components.find((c) => c.type === 'PARKING_TIME');
    if (parking && base.idleFee === null) {
      base.idleFee = {
        pricePerMinute: perMinute(parking.price, parking.vat),
        gracePeriodMin: Math.round((element.x_volt?.grace_period_s ?? 0) / 60),
        maxIdleMin:
          element.x_volt?.max_idle_s === undefined
            ? null
            : Math.round(element.x_volt.max_idle_s / 60),
        startsAt: element.x_volt?.idle_start ?? 'EARLIEST',
      };
    }
  });
  base.maxPrice = tariff.max_price
    ? (tariff.max_price.incl_vat ?? tariff.max_price.excl_vat)
    : null;
  base.minPrice = tariff.min_price
    ? (tariff.min_price.incl_vat ?? tariff.min_price.excl_vat)
    : null;
  const language = meta.language ?? 'es';
  base.text =
    tariff.tariff_alt_text?.find((t) => t.language === language)?.text ??
    tariff.tariff_alt_text?.[0]?.text ??
    null;
  return base;
}

export async function requireSnapshot(db: ISql, sessionId: string): Promise<SnapshotRow> {
  const row = await loadSessionSnapshot(db, sessionId);
  if (!row) throw new NotFoundError('session_tariff_snapshot', sessionId);
  return row;
}
