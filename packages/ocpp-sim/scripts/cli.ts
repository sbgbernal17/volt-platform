/**
 * Arranca un cargador simulado contra un gateway. Variables: SIM_IDENTITY, SIM_PASSWORD,
 * SIM_ENDPOINT (p. ej. ws://localhost:9220/ocpp), SIM_CONNECTORS.
 */
import { SimulatedChargePoint } from '../src/simulated-charge-point.ts';

const identity = process.env.SIM_IDENTITY ?? 'SIM-001';
const password = process.env.SIM_PASSWORD ?? null;
const endpoint = process.env.SIM_ENDPOINT ?? 'ws://127.0.0.1:9220/ocpp';
const connectors = Number(process.env.SIM_CONNECTORS ?? '2');

const sim = new SimulatedChargePoint({ identity, password, endpoint, connectors });
sim.on('call', (call) => console.log(`<- ${call.action}`, JSON.stringify(call.params)));
sim.on('boot', (boot) => console.log('BootNotification.conf', boot));
sim.on('close', (event) => console.log('conexión cerrada', event));

const boot = await sim.start();
console.log(`simulador ${identity} conectado a ${endpoint}; boot=${boot.status}`);
const heartbeatMs =
  Math.max(10, Number(sim.configuration.get('HeartbeatInterval')?.value ?? '60')) * 1000;
const timer = setInterval(() => void sim.heartbeat().catch(() => undefined), heartbeatMs);

const shutdown = async () => {
  clearInterval(timer);
  await sim.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
