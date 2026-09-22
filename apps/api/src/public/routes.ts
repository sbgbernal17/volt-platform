import {
  CsmsError,
  getEvseByCode,
  getSessionView,
  listLocations,
  listSessionViews,
  type SessionService,
  VOLT_TENANT_ID,
} from '@volt/csms';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ISql } from 'postgres';
import { z } from 'zod';
import { type DriverVerifier, driverAuthHook } from './auth.ts';
import { isSessionFinished, toPublicSession } from './sessions-view.ts';
import { streamSessionEvents } from './sse.ts';

export interface PublicRoutesOptions {
  sql: ISql;
  verifier?: DriverVerifier | undefined;
  sessions?: SessionService | undefined;
  ssePollMs: number;
  sseHeartbeatMs: number;
}

const params = z.object({ id: z.string().uuid() });
const startBody = z.object({ evseId: z.string().min(1).max(48) });

function idempotencyKey(request: FastifyRequest): string | undefined {
  const header = request.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.length <= 128 ? value : undefined;
}

/**
 * API pública de la app Volt (ARQ §1.4): sedes con estado en vivo, detalle de EVSE, sesiones del
 * conductor con inicio, parada, cancelación y flujo SSE de progreso.
 */
export async function publicRoutes(
  app: FastifyInstance,
  options: PublicRoutesOptions,
): Promise<void> {
  const { sql } = options;
  const tenantId = VOLT_TENANT_ID;
  const requireSessions = (): SessionService => {
    if (!options.sessions)
      throw new CsmsError(
        'El enlace con el gateway OCPP no está configurado',
        503,
        'GATEWAY_UNAVAILABLE',
      );
    return options.sessions;
  };

  app.get('/locations', async () => {
    const locations = await listLocations(sql, tenantId);
    return {
      items: locations.map((site) => ({
        id: site.id,
        code: site.code,
        name: site.name,
        address: site.address,
        city: site.city,
        latitude: Number(site.latitude),
        longitude: Number(site.longitude),
        timezone: site.timezone,
        accessType: site.access_type,
        openingHours: site.opening_hours,
        evses: site.evses.map((evse) => ({
          evseId: evse.evse_code,
          chargeBoxId: evse.charge_box_id,
          connectorId: evse.ocpp_connector_id,
          standard: evse.standard,
          powerType: evse.power_type,
          maxPowerKw: evse.max_power_w === null ? null : evse.max_power_w / 1000,
          status: evse.status,
        })),
      })),
    };
  });

  app.get('/evses/:evseId', async (request) => {
    const { evseId } = z.object({ evseId: z.string().min(1).max(48) }).parse(request.params);
    const evse = await getEvseByCode(sql, tenantId, evseId);
    return {
      evseId: evse.evse_code,
      chargeBoxId: evse.charge_box_id,
      connectorId: evse.ocpp_connector_id,
      standard: evse.standard,
      powerType: evse.power_type,
      maxPowerKw: evse.max_power_w === null ? null : evse.max_power_w / 1000,
      status: evse.status,
      visibleInApp: evse.visible_in_app,
      tariff: null,
    };
  });

  await app.register(async (privateApp) => {
    privateApp.addHook('preHandler', driverAuthHook(options.verifier));

    privateApp.post('/sessions', async (request, reply) => {
      const driver = request.driver as NonNullable<FastifyRequest['driver']>;
      const body = startBody.parse(request.body);
      const session = await requireSessions().requestStart({
        tenantId,
        evseCode: body.evseId,
        driverId: driver.driverId,
        channel: 'APP',
        requestedBy: `driver:${driver.driverId}`,
        idempotencyKey: idempotencyKey(request),
      });
      const view = await getSessionView(sql, session.id);
      if (view.state === 'FAILED') {
        reply.code(409);
        return {
          error: {
            code: view.failure_code ?? 'SESSION_FAILED',
            message: 'No se pudo iniciar la carga',
          },
          session: toPublicSession(view),
        };
      }
      reply.code(202);
      return toPublicSession(view);
    });

    privateApp.get('/sessions', async (request) => {
      const driver = request.driver as NonNullable<FastifyRequest['driver']>;
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(200).optional() })
        .parse(request.query ?? {});
      const items = await listSessionViews(sql, {
        tenantId,
        driverId: driver.driverId,
        limit: query.limit,
      });
      return { items: items.map((row) => toPublicSession(row)) };
    });

    const ownSession = async (request: FastifyRequest) => {
      const driver = request.driver as NonNullable<FastifyRequest['driver']>;
      const { id } = params.parse(request.params);
      const view = await getSessionView(sql, id);
      if (view.driver_id !== driver.driverId)
        throw new CsmsError(`session ${id} no existe`, 404, 'NOT_FOUND');
      return view;
    };

    privateApp.get('/sessions/:id', async (request) => toPublicSession(await ownSession(request)));

    privateApp.post('/sessions/:id/stop', async (request, reply) => {
      const driver = request.driver as NonNullable<FastifyRequest['driver']>;
      const view = await ownSession(request);
      await requireSessions().requestStop(view.id, `driver:${driver.driverId}`);
      reply.code(202);
      return toPublicSession(await getSessionView(sql, view.id));
    });

    privateApp.post('/sessions/:id/cancel', async (request) => {
      const driver = request.driver as NonNullable<FastifyRequest['driver']>;
      const view = await ownSession(request);
      await requireSessions().cancel(view.id, `driver:${driver.driverId}`);
      return toPublicSession(await getSessionView(sql, view.id));
    });

    privateApp.get('/sessions/:id/events', async (request, reply) => {
      const view = await ownSession(request);
      await streamSessionEvents(request, reply, sql, view.id, {
        pollMs: options.ssePollMs,
        heartbeatMs: options.sseHeartbeatMs,
        isFinished: async () => isSessionFinished((await getSessionView(sql, view.id)).state),
      });
    });
  });
}
