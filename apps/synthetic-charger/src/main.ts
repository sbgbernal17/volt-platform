import { createSql } from '@volt/db';
import { createLogger } from '@volt/logging';
import { SimulatedChargePoint } from '@volt/ocpp-sim';
import { loadConfig } from './config.ts';
import { type SyntheticStatus, startHealthServer } from './health.ts';
import { ensureSyntheticChargePoint } from './seed.ts';
import { runTestSession } from './session.ts';

const config = loadConfig();
const logger = createLogger({
  service: 'synthetic-charger',
  level: config.LOG_LEVEL,
  pretty: config.NODE_ENV === 'development',
  env: config.VOLT_ENV,
});

const status: SyntheticStatus = {
  connected: false,
  chargeBoxId: config.SYNTHETIC_CHARGE_BOX_ID,
  cycles: { ok: 0, error: 0 },
  lastCycleAt: null,
};
const health =
  config.SYNTHETIC_HEALTH_PORT > 0
    ? startHealthServer(config.SYNTHETIC_HEALTH_PORT, () => status)
    : undefined;

const sql = config.DATABASE_URL
  ? createSql(config.DATABASE_URL, {
      max: 2,
      applicationName: 'volt-synthetic-charger',
      sslCa: config.DATABASE_SSL_CA,
    })
  : undefined;

let stopping = false;
let current: SimulatedChargePoint | undefined;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cycle(result: 'ok' | 'error', extra: Record<string, unknown>): void {
  status.cycles[result] += 1;
  status.lastCycleAt = new Date().toISOString();
  logger.info(
    { event: 'synthetic.cycle', result, chargeBoxId: config.SYNTHETIC_CHARGE_BOX_ID, ...extra },
    result === 'ok'
      ? 'ciclo del cargador sintético correcto'
      : 'ciclo del cargador sintético fallido',
  );
}

async function credentials(): Promise<string> {
  if (sql) {
    const seeded = await ensureSyntheticChargePoint(sql, {
      chargeBoxId: config.SYNTHETIC_CHARGE_BOX_ID,
      siteCode: config.SYNTHETIC_SITE_CODE,
    });
    logger.info({ chargePointId: seeded.chargePointId }, 'cargador sintético registrado');
    return seeded.authorizationKey;
  }
  return config.SYNTHETIC_PASSWORD as string;
}

/** Una conexión: arranque, latidos y ciclos hasta que el socket se cierre o falle un latido. */
async function connectedLoop(password: string): Promise<void> {
  const chargePoint = new SimulatedChargePoint({
    identity: config.SYNTHETIC_CHARGE_BOX_ID,
    password,
    endpoint: config.SYNTHETIC_OCPP_URL,
    connectors: 2,
    vendor: 'VoltSim',
    model: 'SIM-DC180',
    firmwareVersion: '1.0.0-synthetic',
    chargingPowerW: 50_000,
    meterValueIntervalMs: 10_000,
    plugDelayMs: 2_000,
    callTimeoutMs: 15_000,
  });
  current = chargePoint;
  let closed = false;
  chargePoint.on('close', (event) => {
    closed = true;
    status.connected = false;
    logger.warn({ code: event.code, reason: event.reason }, 'conexión cerrada por el gateway');
  });

  const started = Date.now();
  const boot = await chargePoint.start();
  if (boot.status !== 'Accepted') {
    throw new Error(`BootNotification respondió ${boot.status}`);
  }
  status.connected = true;
  cycle('ok', {
    phase: 'connect',
    durationMs: Date.now() - started,
    heartbeatInterval: boot.interval,
  });

  const cycleMs = config.SYNTHETIC_CYCLE_MINUTES * 60_000;
  let lastCycle = Date.now();
  let cycles = 0;
  while (!stopping && !closed) {
    await sleep(config.SYNTHETIC_HEARTBEAT_S * 1000);
    if (stopping || closed) break;
    const t0 = Date.now();
    await chargePoint.heartbeat();
    if (Date.now() - lastCycle >= cycleMs) {
      lastCycle = Date.now();
      cycles += 1;
      cycle('ok', { phase: 'heartbeat', durationMs: Date.now() - t0 });
      if (
        config.SYNTHETIC_SESSION_EVERY_CYCLES > 0 &&
        config.SYNTHETIC_API_URL &&
        config.SYNTHETIC_ADMIN_TOKEN &&
        cycles % config.SYNTHETIC_SESSION_EVERY_CYCLES === 0
      ) {
        const result = await runTestSession({
          apiUrl: config.SYNTHETIC_API_URL,
          adminToken: config.SYNTHETIC_ADMIN_TOKEN,
          evseId: `${config.SYNTHETIC_CHARGE_BOX_ID}-1`,
          durationMs: config.SYNTHETIC_SESSION_SECONDS * 1000,
        });
        logger.info(
          { event: 'synthetic.session', result: result.ok ? 'ok' : 'error', ...result },
          result.ok ? 'sesión de prueba completada' : 'sesión de prueba fallida',
        );
      }
    }
  }
  await chargePoint.close().catch(() => undefined);
}

async function main(): Promise<void> {
  logger.info(
    { endpoint: config.SYNTHETIC_OCPP_URL, chargeBoxId: config.SYNTHETIC_CHARGE_BOX_ID },
    'cargador sintético iniciando',
  );
  let backoffMs = 5_000;
  while (!stopping) {
    try {
      const password = await credentials();
      await connectedLoop(password);
      backoffMs = 5_000;
    } catch (error) {
      status.connected = false;
      cycle('error', { phase: 'connect', error: (error as Error).message });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 120_000);
    }
  }
}

const shutdown = async (signal: string) => {
  stopping = true;
  logger.info({ signal }, 'apagando cargador sintético');
  health?.close();
  await current?.close().catch(() => undefined);
  await sql?.end({ timeout: 5 });
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await main();
