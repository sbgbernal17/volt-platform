import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { CallOutcome, SendCallInput } from '@volt/gateway-client';
import { verifySecret } from '@volt/security';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAlarms, raiseAlarm, resolveAlarm } from './alarms.ts';
import { CommandService, type GatewaySender } from './commands.ts';
import { CommissioningService } from './commissioning.ts';
import { issueCredential } from './credentials.ts';
import { ConflictError, NotFoundError } from './errors.ts';
import {
  createChargePoint,
  createConfigTemplate,
  createSite,
  getChargePoint,
  listChargePoints,
  listConfiguration,
  listConnectors,
  listSites,
} from './inventory.ts';
import { listLifecycleEvents, transitionLifecycle } from './lifecycle.ts';
import { VOLT_TENANT_ID } from './types.ts';

const baseUrl = process.env.DATABASE_URL;

/** Doble del gateway: un cargador simulado en memoria con su configuración. */
class FakeGateway implements GatewaySender {
  readonly configuration = new Map<string, { value: string; readonly: boolean }>([
    ['NumberOfConnectors', { value: '2', readonly: true }],
    ['SupportedFeatureProfiles', { value: 'Core,RemoteTrigger', readonly: true }],
    ['HeartbeatInterval', { value: '60', readonly: false }],
    ['MeterValueSampleInterval', { value: '0', readonly: false }],
    ['WebSocketPingInterval', { value: '0', readonly: false }],
  ]);
  readonly calls: SendCallInput[] = [];
  connected = true;
  notSupported = new Set<string>();

  async sendCall(input: SendCallInput): Promise<CallOutcome> {
    this.calls.push(input);
    if (!this.connected) {
      return { ok: false, error: { code: 'NOT_CONNECTED', description: 'sin socket' } };
    }
    const uniqueId = `u-${this.calls.length}`;
    switch (input.action) {
      case 'GetConfiguration':
        return {
          ok: true,
          uniqueId,
          rttMs: 1,
          podId: 'fake',
          result: {
            configurationKey: [...this.configuration].map(([key, entry]) => ({ key, ...entry })),
            unknownKey: [],
          },
        };
      case 'ChangeConfiguration': {
        const key = String(input.payload.key);
        const value = String(input.payload.value);
        if (this.notSupported.has(key)) {
          return {
            ok: true,
            uniqueId,
            rttMs: 1,
            podId: 'fake',
            result: { status: 'NotSupported' },
          };
        }
        const entry = this.configuration.get(key);
        if (!entry || entry.readonly) {
          return { ok: true, uniqueId, rttMs: 1, podId: 'fake', result: { status: 'Rejected' } };
        }
        this.configuration.set(key, { value, readonly: false });
        return { ok: true, uniqueId, rttMs: 1, podId: 'fake', result: { status: 'Accepted' } };
      }
      case 'TriggerMessage':
        return { ok: true, uniqueId, rttMs: 1, podId: 'fake', result: { status: 'Accepted' } };
      case 'UnlockConnector':
        return {
          ok: false,
          uniqueId,
          podId: 'fake',
          error: {
            code: 'CALL_ERROR',
            ocppErrorCode: 'NotSupported',
            description: 'sin cerradura',
          },
        };
      default:
        return {
          ok: false,
          uniqueId,
          podId: 'fake',
          error: { code: 'TIMEOUT', description: 'sin respuesta' },
        };
    }
  }
}

describe.skipIf(!baseUrl)('núcleo del CSMS contra PostgreSQL', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let siteId = '';
  let templateId = '';
  let chargePointId = '';
  const gateway = new FakeGateway();

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 3 });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await database.drop();
  });

  it('crea sedes y plantillas', async () => {
    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'SEDE-A',
      name: 'Sede A',
      address: 'Calle 1 # 2-3',
      city: 'Bogotá',
      countryCode: 'CO',
      latitude: 4.711,
      longitude: -74.0721,
      timezone: 'America/Bogota',
    });
    siteId = site.id;
    expect(site.access_type).toBe('PUBLIC');
    expect((await listSites(sql, VOLT_TENANT_ID)).map((s) => s.code)).toEqual(['SEDE-A']);
    await expect(
      createSite(sql, {
        tenantId: VOLT_TENANT_ID,
        code: 'SEDE-A',
        name: 'Repetida',
        address: 'x',
        latitude: 1,
        longitude: 1,
        timezone: 'America/Bogota',
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const template = await createConfigTemplate(sql, {
      tenantId: VOLT_TENANT_ID,
      name: 'DC-180-publico',
      keys: {
        HeartbeatInterval: '300',
        MeterValueSampleInterval: '15',
        WebSocketPingInterval: '60',
      },
      readOnlyExpected: ['NumberOfConnectors'],
      optionalKeys: ['WebSocketPingInterval'],
    });
    templateId = template.id;
    expect(template.optional_keys).toEqual(['WebSocketPingInterval']);
    expect(template.read_only_expected).toEqual(['NumberOfConnectors']);
  });

  it('da de alta un cargador con sus conectores y el estado deseado de la plantilla', async () => {
    const chargePoint = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId,
      chargeBoxId: 'CP-CSMS-1',
      vendor: 'Acme',
      model: 'DC180',
      configTemplateId: templateId,
      connectors: [
        { ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: 180_000 },
        { ocppConnectorId: 2, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: 180_000 },
      ],
    });
    chargePointId = chargePoint.id;
    expect(chargePoint.lifecycle_status).toBe('INVENTORIED');
    expect(chargePoint.number_of_connectors).toBe(2);
    const connectors = await listConnectors(sql, chargePointId);
    expect(connectors.map((c) => c.evse_code)).toEqual(['CP-CSMS-1-1', 'CP-CSMS-1-2']);
    expect(connectors[0]?.ocpp_status).toBe('Unavailable');
    const config = await listConfiguration(sql, chargePointId);
    expect(config.map((c) => [c.key, c.desired_value, c.source])).toEqual([
      ['HeartbeatInterval', '300', 'TEMPLATE'],
      ['MeterValueSampleInterval', '15', 'TEMPLATE'],
      ['WebSocketPingInterval', '60', 'TEMPLATE'],
    ]);
    expect(
      (await listChargePoints(sql, { tenantId: VOLT_TENANT_ID, lifecycle: 'INVENTORIED' })).length,
    ).toBe(1);
    await expect(
      createChargePoint(sql, {
        tenantId: VOLT_TENANT_ID,
        siteId,
        chargeBoxId: 'CP-CSMS-1',
        connectors: [{ ocppConnectorId: 1, standard: 'IEC_62196_T2', powerType: 'AC_3_PHASE' }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      getChargePoint(sql, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emite la credencial una sola vez, guarda solo el hash y pasa a PROVISIONED', async () => {
    const issued = await issueCredential(sql, { chargePointId, issuedBy: 'staff:ana' });
    expect(issued.authorizationKey).toMatch(/^[0-9A-F]{40}$/);
    expect(issued.lifecycle).toBe('PROVISIONED');
    const rows = await sql<{ key_hash: string; bootstrap: boolean; expires_at: Date }[]>`
      SELECT key_hash, bootstrap, expires_at FROM assets.charge_point_credential WHERE charge_point_id = ${chargePointId}`;
    expect(rows[0]?.key_hash).not.toContain(issued.authorizationKey);
    expect(rows[0]?.bootstrap).toBe(true);
    expect(rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    await expect(verifySecret(issued.authorizationKey, rows[0]?.key_hash ?? '')).resolves.toBe(
      true,
    );
    const events = await listLifecycleEvents(sql, chargePointId);
    expect(events.map((e) => e.to_state)).toEqual(['PROVISIONED', 'INVENTORIED']);
  });

  it('valida las transiciones de ciclo de vida y registra la evidencia', async () => {
    await expect(
      transitionLifecycle(sql, { chargePointId, to: 'OPERATIONAL', actor: 'staff:ana' }),
    ).rejects.toMatchObject({ status: 409, code: 'LIFECYCLE_TRANSITION' });
    const result = await transitionLifecycle(sql, {
      chargePointId,
      to: 'CONNECTED_PENDING',
      actor: 'system:ocpp-gateway',
      evidence: { uniqueId: 'b1', action: 'BootNotification' },
    });
    expect(result).toEqual({ from: 'PROVISIONED', to: 'CONNECTED_PENDING', changed: true });
    // Repetir la misma transición es idempotente.
    expect(
      await transitionLifecycle(sql, { chargePointId, to: 'CONNECTED_PENDING', actor: 'x' }),
    ).toMatchObject({ changed: false });
    const events = await listLifecycleEvents(sql, chargePointId);
    expect(events[0]).toMatchObject({
      from_state: 'PROVISIONED',
      to_state: 'CONNECTED_PENDING',
      actor: 'system:ocpp-gateway',
      evidence: { uniqueId: 'b1', action: 'BootNotification' },
    });
  });

  it('abre alarmas deduplicadas por huella y las resuelve', async () => {
    const first = await raiseAlarm(sql, {
      tenantId: VOLT_TENANT_ID,
      chargePointId,
      kind: 'CONFIG_DRIFT',
      severity: 'WARNING',
      fingerprint: 'CONFIG_DRIFT|CP-CSMS-1',
      details: { keys: ['HeartbeatInterval'] },
    });
    const second = await raiseAlarm(sql, {
      tenantId: VOLT_TENANT_ID,
      chargePointId,
      kind: 'CONFIG_DRIFT',
      severity: 'WARNING',
      fingerprint: 'CONFIG_DRIFT|CP-CSMS-1',
    });
    expect(second.id).toBe(first.id);
    expect(second.occurrences).toBe(2);
    expect((await listAlarms(sql, { tenantId: VOLT_TENANT_ID, chargePointId })).length).toBe(1);
    expect(await resolveAlarm(sql, 'CONFIG_DRIFT|CP-CSMS-1', 'prueba')).toBe(1);
    expect(await resolveAlarm(sql, 'CONFIG_DRIFT|CP-CSMS-1', 'prueba')).toBe(0);
    expect((await listAlarms(sql, { tenantId: VOLT_TENANT_ID, chargePointId })).length).toBe(0);
  });

  it('registra los comandos con su resultado en ops.command', async () => {
    const commands = new CommandService(sql, gateway);
    const ok = await commands.send({
      chargePointId,
      action: 'TriggerMessage',
      payload: { requestedMessage: 'Heartbeat' },
      requestedBy: 'staff:ana',
    });
    expect(ok.command).toMatchObject({
      state: 'ACCEPTED',
      result_status: 'Accepted',
      unique_id: expect.stringMatching(/^u-/),
    });
    const callError = await commands.send({
      chargePointId,
      action: 'UnlockConnector',
      payload: { connectorId: 1 },
      requestedBy: 'staff:ana',
    });
    expect(callError.command).toMatchObject({ state: 'ERROR', error_code: 'NotSupported' });
    const timeout = await commands.send({
      chargePointId,
      action: 'Reset',
      payload: { type: 'Soft' },
      requestedBy: 'staff:ana',
    });
    expect(timeout.command).toMatchObject({ state: 'TIMEOUT', priority: 1, timeout_ms: 30_000 });
    await expect(
      commands.send({
        chargePointId,
        action: 'Reset',
        payload: { type: 'Blando' },
        requestedBy: 'x',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      commands.send({
        chargePointId,
        action: 'RemoteStartTransaction' as never,
        payload: {},
        requestedBy: 'x',
      }),
    ).rejects.toMatchObject({ status: 400 });
    gateway.connected = false;
    const offline = await commands.send({
      chargePointId,
      action: 'GetConfiguration',
      payload: {},
      requestedBy: 'staff:ana',
    });
    expect(offline.command).toMatchObject({
      state: 'CANCELLED',
      error_code: 'NOT_CONNECTED',
      attempts: 0,
    });
    gateway.connected = true;
    expect((await commands.list(chargePointId)).length).toBe(4);
  });

  it('aplica la plantilla, deja el cargador CONFIGURED y detecta deriva después', async () => {
    const commands = new CommandService(sql, gateway);
    const commissioning = new CommissioningService(sql, commands, {
      rebootWaitMs: 100,
      pollMs: 10,
    });
    gateway.notSupported.add('WebSocketPingInterval');
    const result = await commissioning.applyTemplate(chargePointId, 'staff:ana');
    expect(result.before.drift.map((d) => d.key)).toEqual([
      'HeartbeatInterval',
      'MeterValueSampleInterval',
      'WebSocketPingInterval',
    ]);
    expect(result.changes.map((c) => [c.key, c.status])).toEqual([
      ['HeartbeatInterval', 'Accepted'],
      ['MeterValueSampleInterval', 'Accepted'],
      ['WebSocketPingInterval', 'NotSupported'],
    ]);
    expect(result.rebootRequired).toBe(false);
    // La key opcional no soportada queda en deriva pero no bloquea.
    expect(result.after.drift.map((d) => [d.key, d.optional])).toEqual([
      ['WebSocketPingInterval', true],
    ]);
    expect(result.after.blockingDrift).toEqual([]);
    expect(result.lifecycle).toEqual({ from: 'CONNECTED_PENDING', to: 'CONFIGURED' });
    expect(result.configured).toBe(true);
    expect(gateway.calls.at(-1)?.action).toBe('TriggerMessage');
    const chargePoint = await getChargePoint(sql, chargePointId);
    expect(chargePoint.lifecycle_status).toBe('CONFIGURED');
    expect(chargePoint.supported_profiles).toEqual(['Core', 'RemoteTrigger']);
    expect(chargePoint.config_synced_at).toBeInstanceOf(Date);

    // Alguien cambia una key en el cargador: la siguiente lectura detecta la deriva y abre alarma.
    gateway.configuration.set('HeartbeatInterval', { value: '30', readonly: false });
    const drift = await commissioning.detectDrift(chargePointId, 'system:worker');
    expect(drift.sync.blockingDrift.map((d) => [d.key, d.desired, d.observed])).toEqual([
      ['HeartbeatInterval', '300', '30'],
    ]);
    expect(drift.alarm.raised).toBe(true);
    const alarms = await listAlarms(sql, { tenantId: VOLT_TENANT_ID, chargePointId });
    expect(alarms.map((a) => a.kind)).toEqual(['CONFIG_DRIFT']);

    // Re-aplicar la plantilla corrige la deriva y resuelve la alarma.
    const reapplied = await commissioning.applyTemplate(chargePointId, 'staff:ana');
    expect(reapplied.changes.map((c) => [c.key, c.status])).toEqual([
      ['HeartbeatInterval', 'Accepted'],
    ]);
    expect(reapplied.lifecycle).toEqual({ from: 'CONFIGURED', to: 'CONFIGURED' });
    expect((await listAlarms(sql, { tenantId: VOLT_TENANT_ID, chargePointId })).length).toBe(0);

    // Override del operador: se aplica y queda como OVERRIDE.
    const override = await commissioning.setOverride(
      chargePointId,
      'MeterValueSampleInterval',
      '30',
      'staff:ana',
    );
    expect(override.status).toBe('Accepted');
    const config = await listConfiguration(sql, chargePointId);
    expect(config.find((c) => c.key === 'MeterValueSampleInterval')).toMatchObject({
      desired_value: '30',
      observed_value: '30',
      source: 'OVERRIDE',
      drift: false,
    });
    // Una nueva siembra de plantilla no pisa el override.
    await commissioning.applyTemplate(chargePointId, 'staff:ana');
    expect(
      (await listConfiguration(sql, chargePointId)).find(
        (c) => c.key === 'MeterValueSampleInterval',
      )?.desired_value,
    ).toBe('30');
  });

  it('con el cargador desconectado el comisionamiento falla con CHARGER_OFFLINE', async () => {
    gateway.connected = false;
    const commissioning = new CommissioningService(sql, new CommandService(sql, gateway));
    await expect(commissioning.applyTemplate(chargePointId, 'staff:ana')).rejects.toMatchObject({
      status: 409,
      code: 'CHARGER_OFFLINE',
    });
    gateway.connected = true;
  });

  it('dar de baja revoca la credencial y oculta el cargador', async () => {
    await transitionLifecycle(sql, { chargePointId, to: 'TESTED', actor: 'staff:ana' });
    await transitionLifecycle(sql, { chargePointId, to: 'OPERATIONAL', actor: 'staff:ana' });
    let chargePoint = await getChargePoint(sql, chargePointId);
    expect(chargePoint).toMatchObject({ visible_in_app: true, approved_by: 'staff:ana' });
    await transitionLifecycle(sql, {
      chargePointId,
      to: 'DECOMMISSIONED',
      actor: 'staff:ana',
      reason: 'baja',
    });
    chargePoint = await getChargePoint(sql, chargePointId);
    expect(chargePoint.visible_in_app).toBe(false);
    const credentials =
      await sql`SELECT 1 FROM assets.charge_point_credential WHERE charge_point_id = ${chargePointId}`;
    expect(credentials.length).toBe(0);
    await expect(
      issueCredential(sql, { chargePointId, issuedBy: 'staff:ana' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
