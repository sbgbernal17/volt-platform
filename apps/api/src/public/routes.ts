import {
  type BillingAuthorizer,
  type BillingService,
  CsmsError,
  getEvseByCode,
  getSessionView,
  listLocations,
  listSessionViews,
  NoTariffError,
  PricingService,
  quoteEvse,
  type SessionService,
  VOLT_TENANT_ID,
} from '@volt/csms';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { type DriverVerifier, driverAuthHook, driverOf } from './auth.ts';
import { billingPrivateRoutes, billingWebhookRoutes } from './billing-routes.ts';
import { type AppConfigStatic, appConfigRoute, meRoutes } from './me-routes.ts';
import { assertDriverReady } from './readiness.ts';
import { isSessionFinished, toPublicSession } from './sessions-view.ts';
import { streamSessionEvents } from './sse.ts';

export interface PublicRoutesOptions {
  sql: Sql;
  version: string;
  appConfig: AppConfigStatic;
  verifier?: DriverVerifier | undefined;
  sessions?: SessionService | undefined;
  ssePollMs: number;
  sseHeartbeatMs: number;
  billing?: BillingService | undefined;
  authorizer?: BillingAuthorizer | undefined;
  paymentsRedirectUrl?: string | undefined;
}

const params = z.object({ id: z.string().uuid() });
const startBody = z.object({
  evseId: z.string().min(1).max(48),
  quoteId: z.string().uuid().optional(),
});

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
  const pricing = new PricingService(sql, { logger: app.log });
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
    // Cotización pública (segmento PUBLIC): precio por kWh ahora, franjas, ocupación y gracia (TAR §1.3).
    let tariff: Awaited<ReturnType<typeof quoteEvse>> | null = null;
    let tariffError: string | null = null;
    try {
      tariff = await quoteEvse(sql, { tenantId, evseId: evse.evse_uuid, segment: 'PUBLIC' });
    } catch (error) {
      if (error instanceof NoTariffError) tariffError = 'NO_TARIFF';
      else throw error;
    }
    return {
      evseId: evse.evse_code,
      chargeBoxId: evse.charge_box_id,
      connectorId: evse.ocpp_connector_id,
      standard: evse.standard,
      powerType: evse.power_type,
      maxPowerKw: evse.max_power_w === null ? null : evse.max_power_w / 1000,
      status: evse.status,
      visibleInApp: evse.visible_in_app,
      tariff,
      tariffError,
    };
  });

  await billingWebhookRoutes(app, { billing: options.billing });
  await appConfigRoute(app, {
    sql,
    tenantId,
    appConfig: options.appConfig,
    version: options.version,
  });

  await app.register(async (privateApp) => {
    privateApp.addHook('preHandler', driverAuthHook(options.verifier));
    await meRoutes(privateApp, { sql, tenantId });
    await billingPrivateRoutes(privateApp, {
      sql,
      billing: options.billing,
      authorizer: options.authorizer,
      tenantId,
      redirectUrl: options.paymentsRedirectUrl,
    });

    privateApp.post('/sessions', async (request, reply) => {
      const driver = driverOf(request);
      const body = startBody.parse(request.body);
      await assertDriverReady(sql, driver);
      const session = await requireSessions().requestStart({
        tenantId,
        evseCode: body.evseId,
        driverId: driver.driverId,
        channel: 'APP',
        requestedBy: `driver:${driver.driverId}`,
        idempotencyKey: idempotencyKey(request),
        quoteId: body.quoteId,
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
      const driver = driverOf(request);
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
      const driver = driverOf(request);
      const { id } = params.parse(request.params);
      const view = await getSessionView(sql, id);
      if (view.driver_id !== driver.driverId)
        throw new CsmsError(`session ${id} no existe`, 404, 'NOT_FOUND');
      return view;
    };

    privateApp.get('/sessions/:id', async (request) => toPublicSession(await ownSession(request)));

    privateApp.post('/sessions/:id/stop', async (request, reply) => {
      const driver = driverOf(request);
      const view = await ownSession(request);
      await requireSessions().requestStop(view.id, `driver:${driver.driverId}`);
      reply.code(202);
      return toPublicSession(await getSessionView(sql, view.id));
    });

    privateApp.post('/sessions/:id/cancel', async (request) => {
      const driver = driverOf(request);
      const view = await ownSession(request);
      await requireSessions().cancel(view.id, `driver:${driver.driverId}`);
      return toPublicSession(await getSessionView(sql, view.id));
    });

    privateApp.get('/sessions/:id/cost', async (request) => {
      const view = await ownSession(request);
      const cost = await pricing.getSessionCost(sql, view.id);
      return {
        sessionId: view.id,
        sessionNo: view.session_no,
        state: view.state,
        summary: toPublicSession(view).cost,
        segment: cost.segment,
        tariff: cost.snapshot,
        running: cost.running,
        final: cost.final,
      };
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
