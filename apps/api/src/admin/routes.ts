import {
  assignTemplate,
  CONNECTOR_STANDARDS,
  type CommandService,
  type CommissioningService,
  CsmsError,
  createChargePoint,
  createConfigTemplate,
  createDriver,
  createSite,
  getChargePoint,
  getConfigTemplate,
  getCredentialSummary,
  getSessionView,
  getSite,
  issueCredential,
  listAggregateEvents,
  listAlarms,
  listChargePoints,
  listConfigTemplates,
  listConfiguration,
  listConnectors,
  listConnectorsLive,
  listDrivers,
  listLifecycleEvents,
  listSessionViews,
  listSites,
  POWER_TYPES,
  REMOTE_ACTIONS,
  resolveAlarmById,
  type SessionService,
  SITE_ACCESS_TYPES,
  transitionLifecycle,
  VOLT_TENANT_ID,
} from '@volt/csms';
import { LIFECYCLE_STATES, SESSION_STATES } from '@volt/domain';
import { constantTimeEquals } from '@volt/security';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { isSessionFinished, toPublicSession } from '../public/sessions-view.ts';
import { streamSessionEvents } from '../public/sse.ts';

export interface AdminRoutesOptions {
  sql: Sql;
  token: string;
  commands?: CommandService;
  commissioning?: CommissioningService;
  sessions?: SessionService;
  ssePollMs?: number;
  sseHeartbeatMs?: number;
}

const driverBody = z.object({
  email: z.string().email().max(120).optional(),
  phone: z.string().max(32).optional(),
  displayName: z.string().max(120).optional(),
  locale: z.enum(['es', 'en']).optional(),
});

const sessionStartBody = z.object({
  evseId: z.string().min(1).max(48).optional(),
  evseUuid: z.string().uuid().optional(),
  channel: z.enum(['OPERATOR', 'TEST']).default('OPERATOR'),
  driverId: z.string().uuid().optional(),
});

const uuid = z.string().uuid();
const params = z.object({ id: uuid });

const siteBody = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  address: z.string().min(1).max(200),
  city: z.string().max(80).optional(),
  postalCode: z.string().max(16).optional(),
  countryCode: z.string().length(2).default('CO'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(1).default('America/Bogota'),
  accessType: z.enum(SITE_ACCESS_TYPES).optional(),
  openingHours: z.record(z.string(), z.unknown()).optional(),
  gridMaxPowerW: z.number().int().positive().optional(),
});

const templateBody = z.object({
  name: z.string().min(1).max(80),
  version: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  appliesTo: z.record(z.string(), z.unknown()).optional(),
  keys: z.record(z.string().min(1).max(50), z.string().max(500)),
  readOnlyExpected: z.array(z.string().max(50)).optional(),
  optionalKeys: z.array(z.string().max(50)).optional(),
});

const connectorBody = z.object({
  ocppConnectorId: z.number().int().min(1).max(64),
  standard: z.enum(CONNECTOR_STANDARDS),
  powerType: z.enum(POWER_TYPES),
  maxPowerW: z.number().int().positive().optional(),
  maxCurrentA: z.number().int().positive().optional(),
  maxVoltageV: z.number().int().positive().optional(),
  minVoltageV: z.number().int().positive().optional(),
  evseId: z.string().min(1).max(48).optional(),
  physicalReference: z.string().max(40).optional(),
});

const chargePointBody = z.object({
  siteId: uuid,
  chargeBoxId: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[A-Za-z0-9_.-]+$/, 'solo letras, números, guion, punto y guion bajo'),
  vendor: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  serialNumber: z.string().max(80).optional(),
  securityProfile: z.number().int().min(1).max(3).optional(),
  configTemplateId: uuid.optional(),
  heartbeatIntervalS: z.number().int().min(10).max(86_400).optional(),
  connectors: z.array(connectorBody).min(1).max(64),
});

const lifecycleBody = z.object({
  to: z.enum(LIFECYCLE_STATES),
  reason: z.string().max(500).optional(),
});

const commandBody = z.object({
  action: z.enum(REMOTE_ACTIONS),
  payload: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
});

const overrideBody = z.object({ value: z.string().max(500) });
const templateAssignBody = z.object({ templateId: uuid });
const resolveBody = z.object({ resolution: z.string().min(1).max(500) });

function actorOf(request: FastifyRequest): string {
  const header = request.headers['x-actor'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && /^[A-Za-z0-9:_.@-]{1,80}$/.test(value) ? value : 'staff:admin-token';
}

function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? Number(item) : item,
    ),
  ) as T;
}

/**
 * Rutas de administración (back-office) de la iteración 2: sedes, plantillas, cargadores,
 * credenciales, comisionamiento, configuración, comandos, ciclo de vida y alarmas.
 * Autenticación: `Authorization: Bearer <API_ADMIN_TOKEN>`; el actor se toma de `X-Actor`.
 */
export async function adminRoutes(
  app: FastifyInstance,
  options: AdminRoutesOptions,
): Promise<void> {
  const { sql, commands, commissioning } = options;
  const tenantId = VOLT_TENANT_ID;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization ?? '';
    const [scheme, presented] = header.split(' ');
    if (
      scheme?.toLowerCase() !== 'bearer' ||
      !presented ||
      !constantTimeEquals(presented, options.token)
    ) {
      reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Token de administración inválido' } });
    }
  });

  const requireGateway = (): { commands: CommandService; commissioning: CommissioningService } => {
    if (!commands || !commissioning) {
      throw new CsmsError(
        'El enlace con el gateway OCPP no está configurado',
        503,
        'GATEWAY_UNAVAILABLE',
      );
    }
    return { commands, commissioning };
  };

  // ---- Sedes ----
  app.get('/sites', async () => ({ items: serialize(await listSites(sql, tenantId)) }));
  app.post('/sites', async (request, reply) => {
    const body = siteBody.parse(request.body);
    const site = await createSite(sql, { tenantId, ...body });
    reply.code(201);
    return serialize(site);
  });
  app.get('/sites/:id', async (request) =>
    serialize(await getSite(sql, params.parse(request.params).id)),
  );

  // ---- Plantillas ----
  app.get('/config-templates', async () => ({
    items: serialize(await listConfigTemplates(sql, tenantId)),
  }));
  app.post('/config-templates', async (request, reply) => {
    const body = templateBody.parse(request.body);
    const template = await createConfigTemplate(sql, { tenantId, ...body });
    reply.code(201);
    return serialize(template);
  });
  app.get('/config-templates/:id', async (request) =>
    serialize(await getConfigTemplate(sql, params.parse(request.params).id)),
  );

  // ---- Cargadores ----
  app.get('/charge-points', async (request) => {
    const query = z
      .object({ siteId: uuid.optional(), lifecycle: z.enum(LIFECYCLE_STATES).optional() })
      .parse(request.query ?? {});
    return { items: serialize(await listChargePoints(sql, { tenantId, ...query })) };
  });
  app.post('/charge-points', async (request, reply) => {
    const body = chargePointBody.parse(request.body);
    const chargePoint = await createChargePoint(sql, { tenantId, ...body });
    reply.code(201);
    return serialize(chargePoint);
  });
  app.get('/charge-points/:id', async (request) => {
    const { id } = params.parse(request.params);
    const chargePoint = await getChargePoint(sql, id);
    const [connectors, live, credential, configuration, events, alarms] = await Promise.all([
      listConnectors(sql, id),
      listConnectorsLive(sql, id),
      getCredentialSummary(sql, id),
      listConfiguration(sql, id),
      listLifecycleEvents(sql, id, 20),
      listAlarms(sql, { tenantId, chargePointId: id }),
    ]);
    const liveById = new Map(live.map((l) => [l.connector_id, l.status]));
    return serialize({
      ...chargePoint,
      connectors: connectors.map((c) => ({ ...c, live_status: liveById.get(c.id) ?? 'Offline' })),
      credential: credential ?? null,
      configuration,
      drift: configuration.filter((c) => c.drift).map((c) => c.key),
      lifecycle_events: events,
      alarms,
    });
  });
  app.post('/charge-points/:id/credentials', async (request, reply) => {
    const { id } = params.parse(request.params);
    const issued = await issueCredential(sql, { chargePointId: id, issuedBy: actorOf(request) });
    reply.code(201);
    return {
      chargeBoxId: issued.chargeBoxId,
      authorizationKey: issued.authorizationKey,
      expiresAt: issued.expiresAt.toISOString(),
      lifecycle: issued.lifecycle,
      note: 'La clave se muestra una sola vez; configúrala en el cargador como contraseña Basic Auth (usuario = chargeBoxId).',
    };
  });
  app.put('/charge-points/:id/template', async (request) => {
    const { id } = params.parse(request.params);
    const { templateId } = templateAssignBody.parse(request.body);
    await assignTemplate(sql, id, templateId);
    return serialize(await getChargePoint(sql, id));
  });
  app.post('/charge-points/:id/lifecycle', async (request) => {
    const { id } = params.parse(request.params);
    const body = lifecycleBody.parse(request.body);
    const result = await transitionLifecycle(sql, {
      chargePointId: id,
      to: body.to,
      actor: actorOf(request),
      ...(body.reason ? { reason: body.reason } : {}),
      evidence: { via: 'admin-api' },
    });
    return result;
  });
  app.get('/charge-points/:id/lifecycle-events', async (request) => ({
    items: serialize(await listLifecycleEvents(sql, params.parse(request.params).id)),
  }));

  // ---- Configuración y comisionamiento ----
  app.get('/charge-points/:id/configuration', async (request) => ({
    items: serialize(await listConfiguration(sql, params.parse(request.params).id)),
  }));
  app.post('/charge-points/:id/commission', async (request) => {
    const { id } = params.parse(request.params);
    return serialize(await requireGateway().commissioning.applyTemplate(id, actorOf(request)));
  });
  app.post('/charge-points/:id/configuration/sync', async (request) => {
    const { id } = params.parse(request.params);
    return serialize(await requireGateway().commissioning.detectDrift(id, actorOf(request)));
  });
  app.put('/charge-points/:id/configuration/:key', async (request) => {
    const { id, key } = z
      .object({ id: uuid, key: z.string().min(1).max(50) })
      .parse(request.params);
    const { value } = overrideBody.parse(request.body);
    return serialize(
      await requireGateway().commissioning.setOverride(id, key, value, actorOf(request)),
    );
  });

  // ---- Comandos ----
  app.post('/charge-points/:id/commands', async (request) => {
    const { id } = params.parse(request.params);
    const body = commandBody.parse(request.body);
    const result = await requireGateway().commands.send({
      chargePointId: id,
      action: body.action,
      payload: body.payload,
      requestedBy: actorOf(request),
      ...(body.timeoutMs ? { timeoutMs: body.timeoutMs } : {}),
    });
    return serialize(result);
  });
  app.get('/charge-points/:id/commands', async (request) => ({
    items: serialize(await requireGateway().commands.list(params.parse(request.params).id)),
  }));

  // ---- Alarmas ----
  app.get('/alarms', async (request) => {
    const query = z
      .object({ chargePointId: uuid.optional(), includeResolved: z.coerce.boolean().optional() })
      .parse(request.query ?? {});
    return { items: serialize(await listAlarms(sql, { tenantId, ...query })) };
  });
  app.post('/alarms/:id/resolve', async (request) => {
    const { id } = params.parse(request.params);
    const { resolution } = resolveBody.parse(request.body);
    const alarm = await resolveAlarmById(sql, id, resolution, actorOf(request));
    if (!alarm)
      throw new CsmsError(`La alarma ${id} no existe o ya está resuelta`, 404, 'NOT_FOUND');
    return serialize(alarm);
  });

  // ---- Conductores ----
  app.get('/drivers', async () => ({ items: serialize(await listDrivers(sql, tenantId)) }));
  app.post('/drivers', async (request, reply) => {
    const body = driverBody.parse(request.body);
    const driver = await createDriver(sql, { tenantId, ...body });
    reply.code(201);
    return serialize(driver);
  });

  // ---- Sesiones (operador y pruebas de comisionamiento) ----
  const requireSessions = (): SessionService => {
    if (!options.sessions) {
      throw new CsmsError(
        'El enlace con el gateway OCPP no está configurado',
        503,
        'GATEWAY_UNAVAILABLE',
      );
    }
    return options.sessions;
  };
  app.post('/sessions', async (request, reply) => {
    const body = sessionStartBody.parse(request.body);
    const session = await requireSessions().requestStart({
      tenantId,
      evseCode: body.evseId,
      evseId: body.evseUuid,
      driverId: body.driverId ?? null,
      channel: body.channel,
      requestedBy: actorOf(request),
    });
    const view = await getSessionView(sql, session.id);
    reply.code(view.state === 'FAILED' ? 409 : 202);
    return serialize({ ...view, public: toPublicSession(view, '/admin/v1') });
  });
  app.get('/sessions', async (request) => {
    const query = z
      .object({
        chargePointId: uuid.optional(),
        driverId: uuid.optional(),
        state: z.enum(SESSION_STATES).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(request.query ?? {});
    return { items: serialize(await listSessionViews(sql, { tenantId, ...query })) };
  });
  app.get('/sessions/:id', async (request) => {
    const { id } = params.parse(request.params);
    const view = await getSessionView(sql, id);
    const events = await listAggregateEvents(sql, 'session', id, 0n, 500);
    return serialize({ ...view, public: toPublicSession(view, '/admin/v1'), events });
  });
  app.post('/sessions/:id/stop', async (request, reply) => {
    const { id } = params.parse(request.params);
    await requireSessions().requestStop(id, actorOf(request));
    reply.code(202);
    return serialize(await getSessionView(sql, id));
  });
  app.post('/sessions/:id/cancel', async (request) => {
    const { id } = params.parse(request.params);
    await requireSessions().cancel(id, actorOf(request));
    return serialize(await getSessionView(sql, id));
  });
  app.get('/sessions/:id/events', async (request, reply) => {
    const { id } = params.parse(request.params);
    await getSessionView(sql, id);
    await streamSessionEvents(request, reply, sql, id, {
      pollMs: options.ssePollMs ?? 1000,
      heartbeatMs: options.sseHeartbeatMs ?? 15_000,
      isFinished: async () => isSessionFinished((await getSessionView(sql, id)).state),
    });
  });
  app.get('/charge-points/:id/transactions', async (request) => {
    const { id } = params.parse(request.params);
    return { items: serialize(await requireSessions().listTransactions(id)) };
  });
}
