import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { CallOutcome, SendCallInput } from '@volt/gateway-client';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAlarms } from '../alarms.ts';
import { CommandService, type GatewaySender } from '../commands.ts';
import { createChargePoint, createSite, getChargePoint } from '../inventory.ts';
import { ensureBaseTariff } from '../pricing/bootstrap.ts';
import { VOLT_TENANT_ID } from '../types.ts';
import { createDriver } from './drivers.ts';
import { getEvseByCode, listLocations } from './locations.ts';
import { listAggregateEvents } from './outbox.ts';
import { SessionService } from './session-service.ts';
import { findIdToken, issueIdToken } from './tokens.ts';
import { type InboundContext, TransactionService } from './transaction-service.ts';

const baseUrl = process.env.DATABASE_URL;

/** Gateway falso: acepta RemoteStart/RemoteStop salvo que se indique lo contrario. */
class FakeGateway implements GatewaySender {
  readonly calls: SendCallInput[] = [];
  remoteStartStatus: 'Accepted' | 'Rejected' = 'Accepted';
  connected = true;
  async sendCall(input: SendCallInput): Promise<CallOutcome> {
    this.calls.push(input);
    if (!this.connected)
      return { ok: false, error: { code: 'NOT_CONNECTED', description: 'sin socket' } };
    const uniqueId = `u-${this.calls.length}`;
    if (input.action === 'RemoteStartTransaction') {
      return {
        ok: true,
        uniqueId,
        rttMs: 1,
        podId: 'fake',
        result: { status: this.remoteStartStatus },
      };
    }
    return { ok: true, uniqueId, rttMs: 1, podId: 'fake', result: { status: 'Accepted' } };
  }
}

describe.skipIf(!baseUrl)('sesiones y transacciones', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let chargePointId = '';
  let driverId = '';
  const gateway = new FakeGateway();
  let sessions: SessionService;
  let transactions: TransactionService;
  const connectedAt = new Date('2026-09-22T10:00:00Z');
  const ctx = (overrides: Partial<InboundContext> = {}): InboundContext => ({
    chargePoint: {
      id: chargePointId,
      identity: 'CP-SES-1',
      tenantId: VOLT_TENANT_ID,
      lifecycle: 'OPERATIONAL',
    },
    uniqueId: `msg-${Math.random().toString(16).slice(2)}`,
    receivedAt: new Date(),
    connectedAt,
    heartbeatIntervalS: 300,
    generation: 1,
    ...overrides,
  });

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 4 });
    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'S1',
      name: 'Sede 1',
      address: 'a',
      latitude: 4.6,
      longitude: -74,
      timezone: 'America/Bogota',
    });
    const cp = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId: site.id,
      chargeBoxId: 'CP-SES-1',
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
    await ensureBaseTariff(sql, { tenantId: VOLT_TENANT_ID, actor: 'staff:test' });
    sessions = new SessionService(sql, new CommandService(sql, gateway), {
      defaultConnectionTimeoutS: 60,
      startTimeoutMarginS: 10,
    });
    transactions = new TransactionService(sql);
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await database.drop();
  });

  it('expone sedes y EVSE con estado en vivo', async () => {
    const locations = await listLocations(sql, VOLT_TENANT_ID);
    expect(locations).toHaveLength(1);
    expect(locations[0]?.evses.map((e) => [e.evse_code, e.status])).toEqual([
      ['CP-SES-1-1', 'Available'],
      ['CP-SES-1-2', 'Available'],
    ]);
    expect((await getEvseByCode(sql, VOLT_TENANT_ID, 'CP-SES-1-1')).ocpp_connector_id).toBe(1);
  });

  it('CU-02: solicitud desde la app, RemoteStart, StartTransaction, MeterValues y parada remota (CU-04)', async () => {
    const session = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-SES-1-1',
      driverId,
      channel: 'APP',
      requestedBy: `driver:${driverId}`,
      idempotencyKey: 'idem-1',
    });
    expect(session.state).toBe('STARTING');
    expect(session.id_tag).toMatch(/^VOLT[0-9A-F]{16}$/);
    expect(session.session_no).toMatch(/^VO-\d{4}-\d{6}$/);
    expect(session.start_deadline_at?.getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(gateway.calls.at(-1)).toMatchObject({
      action: 'RemoteStartTransaction',
      payload: { connectorId: 1, idTag: session.id_tag },
    });
    // Idempotencia de POST /v1/sessions.
    expect(
      (
        await sessions.requestStart({
          tenantId: VOLT_TENANT_ID,
          evseCode: 'CP-SES-1-1',
          channel: 'APP',
          requestedBy: 'x',
          idempotencyKey: 'idem-1',
        })
      ).id,
    ).toBe(session.id);
    // El EVSE está ocupado para otra solicitud.
    await expect(
      sessions.requestStart({
        tenantId: VOLT_TENANT_ID,
        evseCode: 'CP-SES-1-1',
        channel: 'APP',
        requestedBy: 'x',
      }),
    ).rejects.toMatchObject({ code: 'EVSE_BUSY' });

    // Authorize con el idTag de la sesión (AuthorizeRemoteTxRequests=true) y con uno desconocido.
    expect((await transactions.authorize(ctx(), session.id_tag)).idTagInfo.status).toBe('Accepted');
    expect((await transactions.authorize(ctx(), 'DESCONOCIDO')).idTagInfo.status).toBe('Invalid');

    // StartTransaction enlaza la sesión y asigna transactionId; el reintento devuelve el mismo.
    const startedAt = new Date().toISOString();
    const start = await transactions.startTransaction(ctx(), {
      connectorId: 1,
      idTag: session.id_tag,
      meterStart: 1000,
      timestamp: startedAt,
    });
    expect(start.idTagInfo.status).toBe('Accepted');
    expect(start.transactionId).toBeGreaterThanOrEqual(1000);
    expect(start.duplicate).toBe(false);
    const retry = await transactions.startTransaction(ctx(), {
      connectorId: 1,
      idTag: session.id_tag,
      meterStart: 1000,
      timestamp: startedAt,
    });
    expect(retry).toMatchObject({ transactionId: start.transactionId, duplicate: true });
    expect((await sessions.get(session.id)).state).toBe('CHARGING');
    const txCount = await sql<
      { count: bigint }[]
    >`SELECT count(*)::bigint AS count FROM sessions.ocpp_transaction WHERE charge_point_id = ${chargePointId}`;
    expect(Number(txCount[0]?.count)).toBe(1);

    // MeterValues: progreso y evento session.metered.
    await transactions.recordMeterValues(ctx(), {
      connectorId: 1,
      transactionId: start.transactionId,
      meterValue: [
        {
          timestamp: new Date().toISOString(),
          sampledValue: [
            { value: '1500', measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
            { value: '21.6', measurand: 'Power.Active.Import', unit: 'kW' },
            { value: '58', measurand: 'SoC', unit: 'Percent' },
            { value: '231.1', measurand: 'Voltage', unit: 'V', phase: 'L1' },
          ],
        },
      ],
    });
    let current = await sessions.get(session.id);
    expect(current.last_sample).toMatchObject({
      energyWh: 500,
      powerW: 21600,
      soc: 58,
      voltageV: 231.1,
    });
    expect(Number(current.energy_wh)).toBe(500);
    const duplicateSamples = await transactions.recordMeterValues(ctx(), {
      connectorId: 1,
      transactionId: start.transactionId,
      meterValue: [{ timestamp: current.last_sample?.at ?? '', sampledValue: [{ value: '1500' }] }],
    });
    expect(duplicateSamples.samples).toBe(1);
    const rows = await sql<
      { count: bigint }[]
    >`SELECT count(*)::bigint AS count FROM sessions.meter_value WHERE charge_point_id = ${chargePointId}`;
    expect(Number(rows[0]?.count)).toBe(4); // la lectura repetida no duplica filas

    // Suspensión y reanudación por StatusNotification.
    expect(await transactions.onConnectorStatus(ctx(), 1, 'SuspendedEV', 'Charging')).toMatchObject(
      { to: 'SUSPENDED_EV' },
    );
    expect((await sessions.get(session.id)).idle_since).toBeInstanceOf(Date);
    expect(await transactions.onConnectorStatus(ctx(), 1, 'Charging', 'SuspendedEV')).toMatchObject(
      { to: 'CHARGING' },
    );

    // Parada remota (CU-04) y StopTransaction.
    const stopping = await sessions.requestStop(session.id, `driver:${driverId}`);
    expect(stopping.state).toBe('STOPPING');
    expect(gateway.calls.at(-1)).toMatchObject({
      action: 'RemoteStopTransaction',
      payload: { transactionId: start.transactionId },
    });
    const stop = await transactions.stopTransaction(ctx(), {
      transactionId: start.transactionId,
      meterStop: 8420,
      timestamp: new Date().toISOString(),
      reason: 'Remote',
      idTag: session.id_tag,
      transactionData: [
        {
          timestamp: new Date().toISOString(),
          sampledValue: [{ value: '8420', context: 'Transaction.End' }],
        },
      ],
    });
    expect(stop).toMatchObject({
      idTagInfo: { status: 'Accepted' },
      duplicate: false,
      orphan: false,
      sessionId: session.id,
    });
    current = await sessions.get(session.id);
    expect(current.state).toBe('ENDED');
    expect(Number(current.energy_wh)).toBe(7420);
    expect(current.stop_reason).toBe('Remote');
    expect(current.end_kind).toBe('NORMAL');
    // El idTag virtual es de un solo uso.
    expect((await findIdToken(sql, VOLT_TENANT_ID, session.id_tag))?.status).toBe('INVALID');
    expect((await transactions.authorize(ctx(), session.id_tag)).idTagInfo.status).toBe('Invalid');
    // StopTransaction repetido: misma respuesta sin cambios.
    const again = await transactions.stopTransaction(ctx(), {
      transactionId: start.transactionId,
      meterStop: 8420,
      timestamp: new Date().toISOString(),
      reason: 'Remote',
    });
    expect(again.duplicate).toBe(true);
    // Eventos en el outbox, en orden.
    const events = await listAggregateEvents(sql, 'session', session.id);
    expect(events.map((e) => e.type)).toEqual([
      'session.requested',
      'session.authorized',
      'session.starting',
      'session.started',
      'session.metered',
      'session.metered',
      'session.suspended',
      'session.resumed',
      'session.stop_requested',
      'session.ended',
    ]);
  });

  it('CU-05: transacción offline no solicitada, StopTransaction huérfano y de otro cargador', async () => {
    // RFID desconocido durante un corte: se acepta la transacción, idTag Invalid, sesión UNSOLICITED.
    const offlineStart = new Date(connectedAt.getTime() - 30 * 60_000).toISOString();
    const start = await transactions.startTransaction(ctx(), {
      connectorId: 2,
      idTag: 'RFID-DESCONOCIDA',
      meterStart: 500,
      timestamp: offlineStart,
    });
    expect(start.idTagInfo.status).toBe('Invalid');
    const tx = await sql<{ offline_start: boolean; session_id: string; state: string }[]>`
      SELECT offline_start, session_id, state FROM sessions.ocpp_transaction WHERE ocpp_transaction_id = ${start.transactionId}`;
    expect(tx[0]).toMatchObject({ offline_start: true, state: 'ACTIVE' });
    const unsolicited = await sessions.get(tx[0]?.session_id ?? '');
    expect(unsolicited).toMatchObject({
      start_channel: 'UNSOLICITED',
      state: 'CHARGING',
      driver_id: null,
    });
    expect(unsolicited.started_at?.toISOString()).toBe(offlineStart);
    // MeterValues encolados sin transactionId se mapean a la transacción activa del conector.
    const mapped = await transactions.recordMeterValues(ctx(), {
      connectorId: 2,
      meterValue: [
        {
          timestamp: new Date(connectedAt.getTime() - 20 * 60_000).toISOString(),
          sampledValue: [{ value: '900' }],
        },
      ],
    });
    expect(mapped.transactionId).not.toBeNull();
    const offlineStop = new Date(connectedAt.getTime() - 10 * 60_000).toISOString();
    const stop = await transactions.stopTransaction(ctx(), {
      transactionId: start.transactionId,
      meterStop: 1200,
      timestamp: offlineStop,
      reason: 'EVDisconnected',
    });
    expect(stop.orphan).toBe(false);
    const ended = await sessions.get(unsolicited.id);
    expect(ended.state).toBe('ENDED');
    expect(Number(ended.energy_wh)).toBe(700);
    expect(ended.ended_at?.toISOString()).toBe(offlineStop);

    // StopTransaction de un transactionId desconocido: huérfana + alarma; el cargador recibe respuesta.
    const orphan = await transactions.stopTransaction(ctx(), {
      transactionId: 999_999,
      meterStop: 10,
      timestamp: new Date().toISOString(),
    });
    expect(orphan.orphan).toBe(true);
    const orphanRows = await sql<{ state: string; anomaly_flags: string[] }[]>`
      SELECT state, anomaly_flags FROM sessions.ocpp_transaction WHERE ocpp_transaction_id = 999999`;
    expect(orphanRows[0]).toMatchObject({ state: 'ORPHAN', anomaly_flags: ['UNMAPPED_TX'] });
    const alarms = await listAlarms(sql, { tenantId: VOLT_TENANT_ID, chargePointId });
    expect(alarms.map((a) => a.kind)).toContain('ORPHAN_TRANSACTION');

    // Otro cargador intenta cerrar la transacción de CP-SES-1: no se toca y se registra un evento de seguridad.
    const site = await sql<
      { site_id: string }[]
    >`SELECT site_id FROM assets.charge_point WHERE id = ${chargePointId}`;
    const other = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId: site[0]?.site_id ?? '',
      chargeBoxId: 'CP-SES-2',
      connectors: [{ ocppConnectorId: 1, standard: 'IEC_62196_T2', powerType: 'AC_3_PHASE' }],
    });
    const foreign = await transactions.stopTransaction(
      ctx({
        chargePoint: {
          id: other.id,
          identity: 'CP-SES-2',
          tenantId: VOLT_TENANT_ID,
          lifecycle: 'OPERATIONAL',
        },
      }),
      { transactionId: start.transactionId, meterStop: 0, timestamp: new Date().toISOString() },
    );
    expect(foreign.orphan).toBe(true);
    const untouched = await sql<{ meter_stop_wh: bigint; charge_point_id: string }[]>`
      SELECT meter_stop_wh, charge_point_id FROM sessions.ocpp_transaction WHERE ocpp_transaction_id = ${start.transactionId}`;
    expect(untouched).toHaveLength(1);
    expect(Number(untouched[0]?.meter_stop_wh)).toBe(1200);
    const security = await listAlarms(sql, { tenantId: VOLT_TENANT_ID, chargePointId: other.id });
    expect(security.map((a) => [a.kind, a.severity])).toEqual([['SECURITY_EVENT', 'CRITICAL']]);
  });

  it('expira arranques sin StartTransaction y cierra como estimadas las transacciones huérfanas', async () => {
    const session = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-SES-1-1',
      channel: 'OPERATOR',
      requestedBy: 'staff:ana',
    });
    expect(session.state).toBe('STARTING');
    expect(await transactions.expireStartTimeouts(new Date(Date.now() + 3600_000))).toBe(1);
    const expired = await sessions.get(session.id);
    expect(expired).toMatchObject({ state: 'EXPIRED', failure_code: 'CONNECTION_TIMEOUT' });
    // Un StartTransaction tardío con el mismo idTag reabre la sesión (LATE_START).
    const late = await transactions.startTransaction(ctx(), {
      connectorId: 1,
      idTag: session.id_tag,
      meterStart: 100,
      timestamp: new Date().toISOString(),
    });
    expect(late.sessionId).toBe(session.id);
    expect((await sessions.get(session.id)).anomaly_flags).toContain('LATE_START');

    // El cargador se desconecta y no vuelve: cierre estimado con la última lectura.
    await transactions.recordMeterValues(ctx(), {
      connectorId: 1,
      transactionId: late.transactionId,
      meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [{ value: '2600' }] }],
    });
    await sql`UPDATE assets.charge_point SET connected = false, last_disconnect_at = now() - interval '13 hours' WHERE id = ${chargePointId}`;
    expect(await transactions.closeOrphanTransactions(12)).toBe(1);
    const closed = await sessions.get(session.id);
    expect(closed).toMatchObject({ state: 'ENDED', end_kind: 'ESTIMATED' });
    expect(Number(closed.energy_wh)).toBe(2500);
    const txRow = await sql<
      { state: string; meter_stop_wh: bigint }[]
    >`SELECT state, meter_stop_wh FROM sessions.ocpp_transaction WHERE ocpp_transaction_id = ${late.transactionId}`;
    expect(txRow[0]).toMatchObject({ state: 'CLOSED_ESTIMATED' });
    expect(Number(txRow[0]?.meter_stop_wh)).toBe(2600);
    await sql`UPDATE assets.charge_point SET connected = true WHERE id = ${chargePointId}`;
  });

  it('rechaza sesiones en cargadores no operativos, ocupados o sin conexión, y cancela solicitudes', async () => {
    gateway.connected = false;
    const offline = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-SES-1-2',
      channel: 'APP',
      requestedBy: 'x',
    });
    expect(offline).toMatchObject({ state: 'FAILED', failure_code: 'CHARGER_OFFLINE' });
    gateway.connected = true;
    gateway.remoteStartStatus = 'Rejected';
    const rejected = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-SES-1-2',
      channel: 'APP',
      requestedBy: 'x',
    });
    expect(rejected).toMatchObject({ state: 'FAILED', failure_code: 'REMOTE_START_REJECTED' });
    gateway.remoteStartStatus = 'Accepted';

    await sql`UPDATE assets.charge_point SET lifecycle_status = 'CONFIGURED' WHERE id = ${chargePointId}`;
    await expect(
      sessions.requestStart({
        tenantId: VOLT_TENANT_ID,
        evseCode: 'CP-SES-1-2',
        channel: 'APP',
        requestedBy: 'x',
      }),
    ).rejects.toMatchObject({ code: 'CHARGER_NOT_OPERATIONAL' });
    // Una sesión de prueba sí puede arrancar en CONFIGURED y, al terminar, pasa el cargador a TESTED.
    const test = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-SES-1-2',
      channel: 'TEST',
      requestedBy: 'staff:ana',
    });
    expect(test.is_test).toBe(true);
    const testCtx = ctx({
      chargePoint: {
        id: chargePointId,
        identity: 'CP-SES-1',
        tenantId: VOLT_TENANT_ID,
        lifecycle: 'CONFIGURED',
      },
    });
    const start = await transactions.startTransaction(testCtx, {
      connectorId: 2,
      idTag: test.id_tag,
      meterStart: 0,
      timestamp: new Date().toISOString(),
    });
    expect(start.idTagInfo.status).toBe('Accepted');
    await transactions.stopTransaction(testCtx, {
      transactionId: start.transactionId,
      meterStop: 3000,
      timestamp: new Date().toISOString(),
      reason: 'Local',
    });
    expect((await getChargePoint(sql, chargePointId)).lifecycle_status).toBe('TESTED');
    await sql`UPDATE assets.charge_point SET lifecycle_status = 'OPERATIONAL' WHERE id = ${chargePointId}`;

    const cancellable = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-SES-1-2',
      channel: 'APP',
      requestedBy: 'x',
    });
    expect((await sessions.cancel(cancellable.id, 'driver:x')).state).toBe('CANCELLED');
    await expect(sessions.cancel(cancellable.id, 'driver:x')).rejects.toMatchObject({
      code: 'SESSION_NOT_CANCELLABLE',
    });
    // Un token RFID bloqueado se rechaza en Authorize.
    const blocked = await issueIdToken(sql, {
      tenantId: VOLT_TENANT_ID,
      tokenType: 'RFID',
      token: 'RFIDBLOQ',
    });
    await sql`UPDATE auth.id_token SET status = 'BLOCKED' WHERE id = ${blocked.id}`;
    expect((await transactions.authorize(ctx(), 'rfidbloq')).idTagInfo.status).toBe('Blocked');
  });
});
