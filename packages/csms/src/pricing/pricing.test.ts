/**
 * Precios sobre la base de datos: tarifas y versiones, asignaciones y resolución (T11 fail-closed),
 * parámetros, cotización, snapshot al autorizar, costo en curso con alertas de exposición, fin de
 * ocupación, liquidación con líneas, recálculo idempotente (T9) y normalización de kWh (T13).
 */
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { CallOutcome, SendCallInput } from '@volt/gateway-client';
import { VOLT_BASE_TARIFF } from '@volt/tariff-engine';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommandService, type GatewaySender } from '../commands.ts';
import { createChargePoint, createSite } from '../inventory.ts';
import { createDriver } from '../sessions/drivers.ts';
import { getEvseByCode } from '../sessions/locations.ts';
import { listAggregateEvents } from '../sessions/outbox.ts';
import { SessionService } from '../sessions/session-service.ts';
import { type InboundContext, TransactionService } from '../sessions/transaction-service.ts';
import { VOLT_TENANT_ID } from '../types.ts';
import { createAssignment, endAssignment, listAssignments, resolveTariff } from './assignments.ts';
import { ensureBaseTariff } from './bootstrap.ts';
import { stopSessionsOverLimits } from './limits.ts';
import { listParamValues, resolveParam, setParam } from './params.ts';
import { PricingService } from './pricing-service.ts';
import { validateTariffDefinition } from './schema.ts';
import { loadSessionSnapshot, quoteEvse } from './snapshot.ts';
import {
  activateScheduledVersions,
  createTariff,
  createTariffVersion,
  findEffectiveVersion,
  getTariffVersion,
  publishTariffVersion,
  retireTariffVersion,
} from './tariffs.ts';

const baseUrl = process.env.DATABASE_URL;

class FakeGateway implements GatewaySender {
  readonly calls: SendCallInput[] = [];
  async sendCall(input: SendCallInput): Promise<CallOutcome> {
    this.calls.push(input);
    return {
      ok: true,
      uniqueId: `u-${this.calls.length}`,
      rttMs: 1,
      podId: 'fake',
      result: { status: 'Accepted' },
    };
  }
}

const T0 = Date.parse('2026-10-06T15:00:00Z'); // martes 10:00 en Bogotá: franja de respaldo (1.900 COP/kWh)
const at = (minutes: number): Date => new Date(T0 + minutes * 60_000);

describe.skipIf(!baseUrl)('precios: tarifas, snapshot, costo en curso y liquidación', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let siteId = '';
  let chargePointId = '';
  let driverId = '';
  let clock = at(0);
  const gateway = new FakeGateway();
  let pricing: PricingService;
  let sessions: SessionService;
  let transactions: TransactionService;
  const ctx = (receivedAt: Date): InboundContext => ({
    chargePoint: {
      id: chargePointId,
      identity: 'CP-PRC-1',
      tenantId: VOLT_TENANT_ID,
      lifecycle: 'OPERATIONAL',
    },
    uniqueId: `msg-${Math.random().toString(16).slice(2)}`,
    receivedAt,
    connectedAt: at(-60),
    heartbeatIntervalS: 1_000_000,
    generation: 1,
  });

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 4 });
    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'PRC',
      name: 'Sede precios',
      address: 'a',
      latitude: 4.6,
      longitude: -74,
      timezone: 'America/Bogota',
    });
    siteId = site.id;
    const cp = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId,
      chargeBoxId: 'CP-PRC-1',
      connectors: [
        { ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: 180_000 },
        { ocppConnectorId: 2, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: 180_000 },
      ],
    });
    chargePointId = cp.id;
    await sql`UPDATE assets.charge_point SET lifecycle_status = 'OPERATIONAL', visible_in_app = true, connected = true WHERE id = ${chargePointId}`;
    await sql`UPDATE assets.connector SET ocpp_status = 'Available' WHERE charge_point_id = ${chargePointId}`;
    driverId = (
      await createDriver(sql, {
        tenantId: VOLT_TENANT_ID,
        email: 'ana@example.com',
        displayName: 'Ana',
      })
    ).id;
    pricing = new PricingService(sql, { clock: () => clock });
    sessions = new SessionService(sql, new CommandService(sql, gateway), {
      defaultConnectionTimeoutS: 60,
      startTimeoutMarginS: 10,
      clock: () => clock,
    });
    transactions = new TransactionService(sql, { pricing, clock: () => clock });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await database.drop();
  });

  it('T11: sin tarifa vigente la sesión de app falla con NO_TARIFF y una de prueba arranca a costo cero', async () => {
    const failed = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PRC-1-1',
      driverId,
      channel: 'APP',
      requestedBy: `driver:${driverId}`,
    });
    expect(failed).toMatchObject({ state: 'FAILED', failure_code: 'NO_TARIFF' });
    expect(gateway.calls).toHaveLength(0);
    const test = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PRC-1-1',
      channel: 'TEST',
      requestedBy: 'staff:ana',
    });
    expect(test.state).toBe('STARTING');
    const snapshot = await loadSessionSnapshot(sql, test.id);
    expect(snapshot).toMatchObject({ segment: 'INTERNAL', tariff_version_id: null });
    await sessions.cancel(test.id, 'staff:ana');
  });

  it('valida definiciones (esquema y reglas TAR §7.4) y gestiona versiones: publicar, programar, solapar y retirar', async () => {
    const problems = (input: unknown): string => {
      try {
        validateTariffDefinition(input);
        return '';
      } catch (error) {
        const failure = error as Error & { details?: unknown };
        return `${failure.message} ${JSON.stringify(failure.details ?? null)}`;
      }
    };
    expect(
      problems({ ...VOLT_BASE_TARIFF, elements: VOLT_BASE_TARIFF.elements.slice(0, 2) }),
    ).toMatch(/respaldo/);
    expect(
      problems({
        ...VOLT_BASE_TARIFF,
        elements: [VOLT_BASE_TARIFF.elements[2], VOLT_BASE_TARIFF.elements[0]],
      }),
    ).toMatch(/inalcanzables/);
    expect(
      problems({
        ...VOLT_BASE_TARIFF,
        elements: [
          {
            price_components: [{ type: 'ENERGY', price: '1900', vat: '19', step_size: 1 }],
            restrictions: { start_hour: '10:00' },
          },
        ],
      }),
    ).toMatch(/esquema/);
    expect(
      problems({
        ...VOLT_BASE_TARIFF,
        elements: [
          { price_components: [{ type: 'ENERGY', price: '1900', vat: '19', step_size: 1 }] },
          {
            price_components: [{ type: 'PARKING_TIME', price: '90000', vat: '19', step_size: 60 }],
          },
        ],
      }),
    ).toMatch(/grace_period_s/);
    const valid = validateTariffDefinition(VOLT_BASE_TARIFF);
    expect(valid.dimensions).toEqual(['ENERGY', 'PARKING_TIME']);
    expect(valid.warnings).toEqual([]);

    const base = await ensureBaseTariff(sql, {
      tenantId: VOLT_TENANT_ID,
      actor: 'staff:ana',
      now: at(-30),
    });
    expect(base.created).toEqual({ tariff: true, version: true, assignment: true });
    expect(base.version.status).toBe('ACTIVE');
    expect(base.version.tax_included).toBe(true);
    const again = await ensureBaseTariff(sql, {
      tenantId: VOLT_TENANT_ID,
      actor: 'staff:ana',
      now: at(-30),
    });
    expect(again.created).toEqual({ tariff: false, version: false, assignment: false });
    await expect(
      createTariff(sql, {
        tenantId: VOLT_TENANT_ID,
        code: 'VOLT-BASE',
        name: 'x',
        currency: 'COP',
        createdBy: 'staff:ana',
      }),
    ).rejects.toMatchObject({ code: 'TARIFF_EXISTS' });

    // Versión 2 programada para dentro de una hora; la 1 sigue vigente hasta entonces.
    const draft = await createTariffVersion(sql, {
      tariffId: base.tariff.id,
      definition: {
        ...VOLT_BASE_TARIFF,
        elements: [
          { price_components: [{ type: 'ENERGY', price: '2500', vat: '19', step_size: 1 }] },
        ],
      },
      createdBy: 'staff:ana',
    });
    expect(draft).toMatchObject({ version: 2, status: 'DRAFT' });
    const scheduled = await publishTariffVersion(sql, {
      tariffId: base.tariff.id,
      version: 2,
      validFrom: at(60),
      approvedBy: 'staff:ana',
      now: at(0),
    });
    expect(scheduled.status).toBe('SCHEDULED');
    expect((await getTariffVersion(sql, base.tariff.id, 1)).valid_to?.getTime()).toBe(
      at(60).getTime(),
    );
    expect((await findEffectiveVersion(sql, base.tariff.id, at(30)))?.version).toBe(1);
    expect((await findEffectiveVersion(sql, base.tariff.id, at(90)))?.version).toBe(2);
    await expect(
      publishTariffVersion(sql, {
        tariffId: base.tariff.id,
        version: 2,
        approvedBy: 'staff:ana',
        now: at(0),
      }),
    ).rejects.toMatchObject({ code: 'TARIFF_VERSION_NOT_DRAFT' });
    // Cuatro ojos cuando el parámetro lo exige.
    const draft3 = await createTariffVersion(sql, {
      tariffId: base.tariff.id,
      definition: VOLT_BASE_TARIFF,
      createdBy: 'staff:ana',
    });
    await expect(
      publishTariffVersion(sql, {
        tariffId: base.tariff.id,
        version: draft3.version,
        approvedBy: 'staff:ana',
        requireFourEyes: true,
        now: at(0),
      }),
    ).rejects.toMatchObject({ code: 'FOUR_EYES_REQUIRED' });
    // Publicar una vigencia que solape con la programada se rechaza.
    await expect(
      publishTariffVersion(sql, {
        tariffId: base.tariff.id,
        version: draft3.version,
        validFrom: at(30),
        approvedBy: 'staff:luis',
        now: at(0),
      }),
    ).rejects.toMatchObject({ code: 'TARIFF_OVERLAP' });
    // El trabajo de activación pasa la 2 a ACTIVE y retira la 1 cuando llega su hora.
    expect(await activateScheduledVersions(sql, at(61))).toEqual({ activated: 1, retired: 1 });
    expect((await getTariffVersion(sql, base.tariff.id, 1)).status).toBe('RETIRED');
    expect((await getTariffVersion(sql, base.tariff.id, 2)).status).toBe('ACTIVE');
    // Retirar la 2 y volver a la tarifa base (versión 3) para el resto de las pruebas.
    await retireTariffVersion(sql, {
      tariffId: base.tariff.id,
      version: 2,
      actor: 'staff:ana',
      now: at(62),
    });
    expect(await findEffectiveVersion(sql, base.tariff.id, at(63))).toBeUndefined();
    const restored = await publishTariffVersion(sql, {
      tariffId: base.tariff.id,
      version: draft3.version,
      validFrom: at(-120),
      approvedBy: 'staff:luis',
      now: at(63),
    });
    expect(restored.status).toBe('ACTIVE');
    expect((await findEffectiveVersion(sql, base.tariff.id, at(0)))?.version).toBe(3);
  });

  it('resuelve por especificidad, prioridad y segmento con respaldo PUBLIC', async () => {
    const evse = await getEvseByCode(sql, VOLT_TENANT_ID, 'CP-PRC-1-1');
    const platform = await resolveTariff(sql, {
      tenantId: VOLT_TENANT_ID,
      evseId: evse.evse_uuid,
      segment: 'PUBLIC',
      at: at(0),
    });
    expect(platform.kind).toBe('TARIFF');
    if (platform.kind !== 'TARIFF') throw new Error('sin tarifa');
    expect(platform.assignment.scope_type).toBe('PLATFORM');
    expect(platform.version.version).toBe(3);

    const premium = await createTariff(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'SITE-PREMIUM',
      name: 'Premium',
      currency: 'COP',
      createdBy: 'staff:ana',
    });
    const v1 = await createTariffVersion(sql, {
      tariffId: premium.id,
      definition: {
        ...VOLT_BASE_TARIFF,
        id: 'SITE-PREMIUM',
        elements: [
          { price_components: [{ type: 'ENERGY', price: '2500', vat: '19', step_size: 1 }] },
        ],
      },
      createdBy: 'staff:ana',
    });
    await publishTariffVersion(sql, {
      tariffId: premium.id,
      version: v1.version,
      validFrom: at(-10),
      approvedBy: 'staff:ana',
      now: at(0),
    });
    const siteAssignment = await createAssignment(sql, {
      tenantId: VOLT_TENANT_ID,
      scopeType: 'SITE',
      scopeId: siteId,
      segment: 'PUBLIC',
      tariffId: premium.id,
      validFrom: at(-10),
      createdBy: 'staff:ana',
    });
    const gold = await createAssignment(sql, {
      tenantId: VOLT_TENANT_ID,
      scopeType: 'CONNECTOR',
      scopeId: evse.connector_uuid,
      segment: 'MEMBER:GOLD',
      tariffId: premium.id,
      adjustments: [{ type: 'PERCENT', dimension: 'ENERGY', value: '-15', label: 'Gold' }],
      validFrom: at(-10),
      createdBy: 'staff:ana',
    });
    const bySite = await resolveTariff(sql, {
      tenantId: VOLT_TENANT_ID,
      evseId: evse.evse_uuid,
      segment: 'PUBLIC',
      at: at(-8),
    });
    expect(bySite.kind === 'TARIFF' && bySite.assignment.id).toBe(siteAssignment.id);
    expect(bySite.candidates.map((c) => [c.scopeType, c.chosen])).toEqual([
      ['SITE', true],
      ['PLATFORM', false],
    ]);
    const byMember = await resolveTariff(sql, {
      tenantId: VOLT_TENANT_ID,
      evseId: evse.evse_uuid,
      segment: 'MEMBER:GOLD',
      at: at(-8),
    });
    expect(byMember.kind === 'TARIFF' && byMember.assignment.id).toBe(gold.id);
    expect(byMember.kind === 'TARIFF' && byMember.adjustments).toEqual([
      { type: 'PERCENT', dimension: 'ENERGY', value: '-15', label: 'Gold' },
    ]);
    const fleet = await resolveTariff(sql, {
      tenantId: VOLT_TENANT_ID,
      evseId: evse.evse_uuid,
      segment: 'FLEET:ACME',
      at: at(-8),
    });
    expect(fleet.kind === 'TARIFF' && fleet.segmentUsed).toBe('PUBLIC');
    expect(fleet.kind === 'TARIFF' && fleet.assignment.scope_type).toBe('SITE');
    await expect(
      createAssignment(sql, {
        tenantId: VOLT_TENANT_ID,
        scopeType: 'SITE',
        scopeId: siteId,
        segment: 'VIP',
        tariffId: premium.id,
        createdBy: 'x',
      }),
    ).rejects.toThrow();
    // Se terminan antes de at(0) para que el resto de las pruebas resuelva la tarifa base.
    await endAssignment(sql, {
      id: siteAssignment.id,
      tenantId: VOLT_TENANT_ID,
      actor: 'staff:ana',
      now: at(-5),
    });
    await endAssignment(sql, {
      id: gold.id,
      tenantId: VOLT_TENANT_ID,
      actor: 'staff:ana',
      now: at(-5),
    });
    expect(
      (await listAssignments(sql, VOLT_TENANT_ID, { activeAt: at(-4) })).map((a) => a.scope_type),
    ).toEqual(['PLATFORM']);
    expect((await listAssignments(sql, VOLT_TENANT_ID, { includeEnded: true })).length).toBe(3);
    const back = await resolveTariff(sql, {
      tenantId: VOLT_TENANT_ID,
      evseId: evse.evse_uuid,
      segment: 'PUBLIC',
      at: at(-3),
    });
    expect(back.kind === 'TARIFF' && back.assignment.scope_type).toBe('PLATFORM');
  });

  it('parámetros: valida esquema y alcance, resuelve por conector y deja auditoría', async () => {
    expect(
      await resolveParam<number>(sql, 'pricing.exposure_limit_minor', { tenantId: VOLT_TENANT_ID }),
    ).toBe(200_000);
    await expect(
      setParam(sql, {
        key: 'pricing.warn_pct',
        scopeType: 'PLATFORM',
        value: 150,
        updatedBy: 'staff:ana',
        tenantId: VOLT_TENANT_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      setParam(sql, {
        key: 'pricing.warn_pct',
        scopeType: 'CONNECTOR',
        scopeId: chargePointId,
        value: 50,
        updatedBy: 'x',
        tenantId: VOLT_TENANT_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const evse = await getEvseByCode(sql, VOLT_TENANT_ID, 'CP-PRC-1-2');
    await setParam(sql, {
      key: 'pricing.exposure_limit_minor',
      scopeType: 'CONNECTOR',
      scopeId: evse.connector_uuid,
      value: 30_000,
      updatedBy: 'staff:ana',
      reason: 'prueba de tope',
      tenantId: VOLT_TENANT_ID,
    });
    expect(
      await resolveParam<number>(sql, 'pricing.exposure_limit_minor', {
        connectorId: evse.connector_uuid,
      }),
    ).toBe(30_000);
    const other = await getEvseByCode(sql, VOLT_TENANT_ID, 'CP-PRC-1-1');
    expect(
      await resolveParam<number>(sql, 'pricing.exposure_limit_minor', {
        connectorId: other.connector_uuid,
      }),
    ).toBe(200_000);
    expect(
      await resolveParam<number>(sql, 'pricing.exposure_limit_minor', { tenantId: VOLT_TENANT_ID }),
    ).toBe(200_000);
    expect(
      (await listParamValues(sql, 'pricing.exposure_limit_minor')).map((p) => p.scope_type),
    ).toEqual(['CONNECTOR']);
  });

  it('cotiza el EVSE para la app y la cotización se reutiliza al iniciar', async () => {
    const preview = await quoteEvse(sql, {
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PRC-1-1',
      segment: 'PUBLIC',
      at: at(0),
    });
    expect(preview).toMatchObject({
      currency: 'COP',
      taxIncluded: true,
      tariffCode: 'VOLT-BASE',
      tariffVersion: 3,
      energy: { pricePerKwhNow: '1350' },
      idleFee: {
        pricePerMinute: '1500',
        gracePeriodMin: 15,
        maxIdleMin: null,
        startsAt: 'EARLIEST',
      },
      exposureLimit: '200000',
    });
    expect(preview.energy.elements.map((e) => e.pricePerKwh)).toEqual(['1350', '1200', '1350']);
    expect(preview.text).toContain('15 minutos de gracia');
    clock = at(0);
    const session = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PRC-1-1',
      driverId,
      channel: 'APP',
      requestedBy: `driver:${driverId}`,
      quoteId: preview.quoteId,
    });
    expect(session.state).toBe('STARTING');
    const snapshot = await loadSessionSnapshot(sql, session.id);
    expect(snapshot).toMatchObject({ quote_id: preview.quoteId, segment: 'PUBLIC', retro: false });
    expect(snapshot?.snapshot.tariff_code).toBe('VOLT-BASE');
    expect(snapshot?.snapshot.exposure_limit_minor).toBe('200000');
    expect((await sessions.get(session.id)).currency).toBe('COP');
    await sessions.cancel(session.id, 'staff:ana');
  });

  it('sesión completa: costo en curso, kWh normalizados (T13), fin de ocupación, liquidación con líneas y recálculo idempotente (T9)', async () => {
    clock = at(0);
    const session = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PRC-1-1',
      driverId,
      channel: 'APP',
      requestedBy: `driver:${driverId}`,
    });
    const start = await transactions.startTransaction(ctx(at(0)), {
      connectorId: 1,
      idTag: session.id_tag,
      meterStart: 0,
      timestamp: at(0).toISOString(),
    });
    expect(start.idTagInfo.status).toBe('Accepted');
    // Lectura en kWh (T13): 10,0 kWh -> 10.000 Wh; potencia 30 kW.
    await transactions.recordMeterValues(ctx(at(20)), {
      connectorId: 1,
      transactionId: start.transactionId,
      meterValue: [
        {
          timestamp: at(20).toISOString(),
          sampledValue: [
            { value: '10.0', measurand: 'Energy.Active.Import.Register', unit: 'kWh' },
            { value: '30', measurand: 'Power.Active.Import', unit: 'kW' },
          ],
        },
      ],
    });
    let current = await sessions.get(session.id);
    expect(current.running_cost).toMatchObject({
      currency: 'COP',
      tax_included: true,
      total_minor: '13500',
      energy_wh: 10000,
      alerts: [],
    });
    const metered = (await listAggregateEvents(sql, 'session', session.id)).find(
      (e) => e.type === 'session.metered',
    );
    const meteredPayload = metered?.payload.payload as
      | { cost: { total_minor: string } }
      | undefined;
    expect(meteredPayload?.cost.total_minor).toBe('13500');

    // El vehículo se llena a los 40 minutos (SuspendedEV) y el conductor detiene a los 65.
    clock = at(40);
    expect(
      await transactions.onConnectorStatus(ctx(at(40)), 1, 'SuspendedEV', 'Charging'),
    ).toMatchObject({ to: 'SUSPENDED_EV' });
    await transactions.recordMeterValues(ctx(at(40)), {
      connectorId: 1,
      transactionId: start.transactionId,
      meterValue: [
        {
          timestamp: at(40).toISOString(),
          sampledValue: [
            { value: '20000' },
            { value: '0', measurand: 'Power.Active.Import', unit: 'W' },
          ],
        },
      ],
    });
    clock = at(65);
    await sessions.requestStop(session.id, `driver:${driverId}`);
    await transactions.stopTransaction(ctx(at(65)), {
      transactionId: start.transactionId,
      meterStop: 20000,
      timestamp: at(65).toISOString(),
      reason: 'Remote',
    });
    current = await sessions.get(session.id);
    expect(current).toMatchObject({ state: 'ENDED', idle_ended_at: null });
    // La liquidación espera el fin de la ocupación.
    expect(await pricing.settle(session.id, { actor: 'test' })).toMatchObject({
      status: 'waiting',
      reason: 'IDLE_OPEN',
    });
    clock = at(67.5);
    await transactions.onConnectorStatus(ctx(at(67.5)), 1, 'Available', 'Finishing');
    current = await sessions.get(session.id);
    expect(current.idle_ended_at?.getTime()).toBe(at(67.5).getTime());
    expect(await pricing.settle(session.id, { actor: 'test' })).toMatchObject({
      status: 'waiting',
      reason: 'SETTLE_DELAY',
    });
    clock = at(70);
    const settled = await pricing.settle(session.id, { actor: 'test' });
    expect(settled.status).toBe('settled');
    if (settled.status !== 'settled') throw new Error('no liquidada');
    expect(settled.calc).toMatchObject({
      kind: 'FINAL',
      calc_version: 1,
      currency: 'COP',
      capped: false,
    });
    expect(BigInt(settled.calc.total_minor)).toBe(46_500n);
    expect(
      settled.lines.map((l) => [
        l.dimension,
        l.element_ref,
        Number(l.quantity),
        l.unit,
        BigInt(l.amount_minor) + BigInt(l.tax_minor),
      ]),
    ).toEqual([
      ['ENERGY', 'e0', 20, 'kWh', 27_000n],
      ['PARKING_TIME', 'e3', 13, 'min', 19_500n],
    ]);
    expect(settled.calc.summary).toMatchObject({
      energy_wh: 20000,
      charging_time_s: 2400,
      idle_time_s: 1650,
      billable_idle_s: 750,
    });
    current = await sessions.get(session.id);
    expect(current).toMatchObject({
      state: 'SETTLED',
      payment_status: 'NONE',
      currency: 'COP',
      final_calc_id: settled.calc.id,
    });
    expect(BigInt(current.total_minor ?? 0)).toBe(46_500n);
    expect(BigInt(current.tax_minor ?? 0)).toBe(0n);
    const names = (await listAggregateEvents(sql, 'session', session.id)).map((e) => e.type);
    expect(names.slice(-4)).toEqual([
      'session.ended',
      'session.idle_ended',
      'session.priced',
      'session.settled',
    ]);
    // Recalcular sin cambios no crea una versión nueva; la vista de costo devuelve las líneas.
    const recalc = await pricing.recalculate(session.id, { reason: 'prueba', actor: 'staff:ana' });
    expect(recalc.created).toBe(false);
    expect(recalc.calc.id).toBe(settled.calc.id);
    const view = await pricing.getSessionCost(sql, session.id);
    expect(view.final?.lines).toHaveLength(2);
    expect(view.final?.total).toBe('46500');
    expect(view.snapshot?.tariff_code).toBe('VOLT-BASE');
    expect(view.calcs).toHaveLength(1);
    // Liquidar de nuevo es idempotente.
    expect(await pricing.settle(session.id, { actor: 'test' })).toMatchObject({
      status: 'settled',
      alreadySettled: true,
    });
  });

  it('T5: el tope de exposición avisa una vez, se agota una vez y el barrido detiene la sesión', async () => {
    clock = at(100);
    const session = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PRC-1-2',
      driverId,
      channel: 'APP',
      requestedBy: `driver:${driverId}`,
    });
    expect(BigInt((await sessions.get(session.id)).exposure_limit_minor ?? 0)).toBe(30_000n);
    const start = await transactions.startTransaction(ctx(at(100)), {
      connectorId: 2,
      idTag: session.id_tag,
      meterStart: 0,
      timestamp: at(100).toISOString(),
    });
    const sample = async (minute: number, wh: number) => {
      await transactions.recordMeterValues(ctx(at(minute)), {
        connectorId: 2,
        transactionId: start.transactionId,
        meterValue: [
          {
            timestamp: at(minute).toISOString(),
            sampledValue: [
              { value: String(wh) },
              { value: '10000', measurand: 'Power.Active.Import', unit: 'W' },
            ],
          },
        ],
      });
      return sessions.get(session.id);
    };
    let current = await sample(105, 5000);
    expect(current.running_cost?.alerts).toEqual([]);
    expect(current.exposure_warned_at).toBeNull();
    current = await sample(110, 18000); // 24.300 >= 80 % de 30.000; proyección a 10 kW: +2.250 < 30.000
    expect(current.running_cost?.alerts).toContain('PREAUTH_WARN');
    expect(current.exposure_warned_at).not.toBeNull();
    expect(current.exposure_exhausted_at).toBeNull();
    current = await sample(115, 23000); // 31.050 >= 30.000
    expect(current.running_cost?.alerts).toEqual(['PREAUTH_WARN', 'PREAUTH_EXHAUSTED']);
    expect(current.exposure_exhausted_at).not.toBeNull();
    const before = gateway.calls.length;
    expect(await stopSessionsOverLimits(sql, sessions, { now: at(116) })).toEqual({
      exposure: 1,
      duration: 0,
      failed: 0,
    });
    expect(gateway.calls.at(-1)).toMatchObject({
      action: 'RemoteStopTransaction',
      payload: { transactionId: start.transactionId },
    });
    current = await sessions.get(session.id);
    expect(current).toMatchObject({
      state: 'STOPPING',
      stop_requested_by: 'system:exposure-limit',
    });
    // Segundo barrido: nada que hacer (idempotente).
    expect(await stopSessionsOverLimits(sql, sessions, { now: at(117) })).toEqual({
      exposure: 0,
      duration: 0,
      failed: 0,
    });
    expect(gateway.calls.length).toBe(before + 1);
    const events = (await listAggregateEvents(sql, 'session', session.id)).map((e) => e.type);
    expect(events.filter((e) => e === 'session.exposure_warning')).toHaveLength(1);
    expect(events.filter((e) => e === 'session.exposure_exhausted')).toHaveLength(1);
    await transactions.stopTransaction(ctx(at(116)), {
      transactionId: start.transactionId,
      meterStop: 23500,
      timestamp: at(116).toISOString(),
      reason: 'Remote',
    });
    clock = at(117);
    await transactions.onConnectorStatus(ctx(at(117)), 2, 'Available', 'Finishing');
    clock = at(118);
    const settled = await pricing.settle(session.id, { actor: 'test' });
    expect(settled.status).toBe('settled');
    if (settled.status === 'settled') expect(BigInt(settled.calc.total_minor)).toBe(31_725n);
  });

  it('una transacción no solicitada recibe un snapshot retroactivo al liquidar; la duración máxima también detiene', async () => {
    clock = at(200);
    const start = await transactions.startTransaction(ctx(at(200)), {
      connectorId: 2,
      idTag: 'RFID-LOCAL',
      meterStart: 0,
      timestamp: at(200).toISOString(),
    });
    expect(start.idTagInfo.status).toBe('Invalid');
    const sessionId = start.sessionId as string;
    expect(await loadSessionSnapshot(sql, sessionId)).toBeUndefined();
    await transactions.stopTransaction(ctx(at(230)), {
      transactionId: start.transactionId,
      meterStop: 3000,
      timestamp: at(230).toISOString(),
      reason: 'EVDisconnected',
    });
    clock = at(231);
    const settled = await pricing.settle(sessionId, { actor: 'test' });
    expect(settled.status).toBe('settled');
    if (settled.status === 'settled') {
      expect(settled.calc.flags).toContain('RETRO_SNAPSHOT');
      expect(BigInt(settled.calc.total_minor)).toBe(4_050n);
    }
    expect((await loadSessionSnapshot(sql, sessionId))?.retro).toBe(true);

    // Duración máxima: 240 minutos por defecto.
    clock = at(300);
    const long = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PRC-1-1',
      driverId,
      channel: 'APP',
      requestedBy: `driver:${driverId}`,
    });
    const longStart = await transactions.startTransaction(ctx(at(300)), {
      connectorId: 1,
      idTag: long.id_tag,
      meterStart: 0,
      timestamp: at(300).toISOString(),
    });
    expect(await stopSessionsOverLimits(sql, sessions, { now: at(500) })).toEqual({
      exposure: 0,
      duration: 0,
      failed: 0,
    });
    expect(await stopSessionsOverLimits(sql, sessions, { now: at(541) })).toEqual({
      exposure: 0,
      duration: 1,
      failed: 0,
    });
    expect((await sessions.get(long.id)).stop_requested_by).toBe('system:max-duration');
    await transactions.stopTransaction(ctx(at(542)), {
      transactionId: longStart.transactionId,
      meterStop: 100,
      timestamp: at(542).toISOString(),
      reason: 'Remote',
    });
  });
});
