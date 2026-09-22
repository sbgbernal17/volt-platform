/**
 * Rutas de administración de precios (iteración 4, TAR §7.4): tarifas y versiones, asignaciones y
 * resolución explicable, cotización, simulador, parámetros, costo de sesión, recálculo y
 * liquidación manual. Heredan la autenticación de `adminRoutes`.
 */
import {
  ASSIGNMENT_SCOPE_TYPES,
  activateScheduledVersions,
  createAssignment,
  createTariff,
  createTariffVersion,
  endAssignment,
  ensureBaseTariff,
  getEvseByCode,
  getTariff,
  getTariffVersion,
  listAssignments,
  listParamDefinitions,
  listParamValues,
  listTariffAudit,
  listTariffs,
  listTariffVersions,
  PricingService,
  publishTariffVersion,
  quoteEvse,
  resolveParam,
  resolveTariff,
  retireTariffVersion,
  type SessionService,
  segmentSchema,
  setParam,
  toCostResultJson,
  VOLT_TENANT_ID,
  validateTariffDefinition,
} from '@volt/csms';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { actorOf, serialize } from './routes.ts';

export interface PricingRoutesOptions {
  sql: Sql;
  sessions?: SessionService | undefined;
}

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const versionParams = z.object({ id: uuid, version: z.coerce.number().int().min(1) });
const keyParams = z.object({ key: z.string().min(1).max(80) });
const isoDate = z.string().datetime({ offset: true });

const tariffBody = z.object({
  code: z.string().min(2).max(36),
  name: z.string().min(1).max(120),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
const versionBody = z.object({
  definition: z.unknown(),
  taxIncluded: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});
const publishBody = z.object({
  validFrom: isoDate.optional(),
  validTo: isoDate.optional(),
});
const assignmentBody = z.object({
  scopeType: z.enum(ASSIGNMENT_SCOPE_TYPES as [string, ...string[]]),
  scopeId: z.string().min(1).max(64).optional(),
  segment: segmentSchema,
  tariffId: uuid,
  adjustments: z.unknown().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  validFrom: isoDate.optional(),
  validTo: isoDate.optional(),
});
const simulateBody = z.object({
  tariff: z.unknown().optional(),
  tariffVersionId: uuid.optional(),
  timezone: z.string().min(1).max(64).optional(),
  rounding: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']).optional(),
  taxRounding: z.enum(['PER_LINE', 'PER_TAX_GROUP']).optional(),
  taxIncluded: z.boolean().optional(),
  adjustments: z
    .array(
      z.object({
        type: z.enum(['PERCENT', 'AMOUNT']),
        dimension: z.enum(['ENERGY', 'TIME', 'PARKING_TIME', 'FLAT']).optional(),
        value: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  exposureLimitMinor: z.union([z.string().regex(/^\d+$/), z.number().int().min(0)]).optional(),
  warnPct: z.number().int().min(1).max(100).optional(),
  mode: z.enum(['RUNNING', 'FINAL']).optional(),
  now: isoDate.optional(),
  events: z.array(z.unknown()).optional(),
  scenario: z
    .object({
      startAt: isoDate,
      durationMin: z.number().positive().max(1440),
      energyWh: z.number().int().min(0).max(10_000_000),
      suspendedAfterMin: z.number().min(0).optional(),
      idleMin: z.number().min(0).max(1440).optional(),
      sampleEveryMin: z.number().positive().optional(),
      stopReason: z.string().max(32).optional(),
      meterStartWh: z.number().int().min(0).optional(),
      powerW: z.number().int().min(0).optional(),
    })
    .optional(),
});
const paramBody = z.object({
  scopeType: z.enum(['PLATFORM', 'TENANT', 'SITE', 'CHARGE_POINT', 'CONNECTOR']),
  scopeId: uuid.optional(),
  value: z.unknown(),
  reason: z.string().max(300).optional(),
});

export async function pricingRoutes(
  app: FastifyInstance,
  options: PricingRoutesOptions,
): Promise<void> {
  const { sql } = options;
  const tenantId = VOLT_TENANT_ID;
  const pricing = new PricingService(sql, { logger: app.log });
  const date = (value: string | undefined): Date | undefined =>
    value ? new Date(value) : undefined;

  // ---- Tarifas y versiones ----
  app.get('/tariffs', async () => ({ items: serialize(await listTariffs(sql, tenantId)) }));
  app.post('/tariffs', async (request, reply) => {
    const body = tariffBody.parse(request.body);
    reply.code(201);
    return serialize(await createTariff(sql, { tenantId, ...body, createdBy: actorOf(request) }));
  });
  app.post('/tariffs/bootstrap', async (request) =>
    serialize(await ensureBaseTariff(sql, { tenantId, actor: actorOf(request) })),
  );
  app.post('/tariffs/activate-scheduled', async () => activateScheduledVersions(sql));
  app.get('/tariffs/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const tariff = await getTariff(sql, id);
    return serialize({
      ...tariff,
      versions: await listTariffVersions(sql, id),
      assignments: await listAssignments(sql, tenantId, { tariffId: id }),
    });
  });
  app.post('/tariffs/:id/versions/validate', async (request) => {
    const body = versionBody.parse(request.body);
    const validation = validateTariffDefinition(body.definition);
    return { ok: true, dimensions: validation.dimensions, warnings: validation.warnings };
  });
  app.post('/tariffs/:id/versions', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = versionBody.parse(request.body);
    reply.code(201);
    return serialize(
      await createTariffVersion(sql, {
        tariffId: id,
        definition: body.definition,
        taxIncluded:
          body.taxIncluded ??
          (await resolveParam<boolean>(sql, 'pricing.tax_included', { tenantId })),
        notes: body.notes,
        createdBy: actorOf(request),
      }),
    );
  });
  app.get('/tariffs/:id/versions/:version', async (request) => {
    const { id, version } = versionParams.parse(request.params);
    return serialize(await getTariffVersion(sql, id, version));
  });
  app.post('/tariffs/:id/versions/:version/publish', async (request) => {
    const { id, version } = versionParams.parse(request.params);
    const body = publishBody.parse(request.body ?? {});
    return serialize(
      await publishTariffVersion(sql, {
        tariffId: id,
        version,
        validFrom: date(body.validFrom),
        validTo: date(body.validTo) ?? null,
        approvedBy: actorOf(request),
        requireFourEyes: await resolveParam<boolean>(sql, 'pricing.require_four_eyes', {
          tenantId,
        }),
      }),
    );
  });
  app.post('/tariffs/:id/versions/:version/retire', async (request) => {
    const { id, version } = versionParams.parse(request.params);
    return serialize(
      await retireTariffVersion(sql, { tariffId: id, version, actor: actorOf(request) }),
    );
  });

  // ---- Asignaciones y resolución ----
  app.get('/tariff-assignments', async (request) => {
    const query = z
      .object({
        scopeType: z.enum(ASSIGNMENT_SCOPE_TYPES as [string, ...string[]]).optional(),
        scopeId: z.string().optional(),
        segment: z.string().optional(),
        tariffId: uuid.optional(),
        includeEnded: z.coerce.boolean().optional(),
      })
      .parse(request.query ?? {});
    return {
      items: serialize(
        await listAssignments(sql, tenantId, {
          scopeType: query.scopeType as (typeof ASSIGNMENT_SCOPE_TYPES)[number] | undefined,
          scopeId: query.scopeId,
          segment: query.segment,
          tariffId: query.tariffId,
          includeEnded: query.includeEnded,
        }),
      ),
    };
  });
  app.post('/tariff-assignments', async (request, reply) => {
    const body = assignmentBody.parse(request.body);
    reply.code(201);
    return serialize(
      await createAssignment(sql, {
        tenantId,
        scopeType: body.scopeType as (typeof ASSIGNMENT_SCOPE_TYPES)[number],
        scopeId: body.scopeId,
        segment: body.segment,
        tariffId: body.tariffId,
        adjustments: body.adjustments,
        priority: body.priority,
        validFrom: date(body.validFrom),
        validTo: date(body.validTo) ?? null,
        createdBy: actorOf(request),
      }),
    );
  });
  app.post('/tariff-assignments/:id/end', async (request) => {
    const { id } = idParams.parse(request.params);
    return serialize(await endAssignment(sql, { id, tenantId, actor: actorOf(request) }));
  });
  app.get('/tariff-assignments/resolve', async (request) => {
    const query = z
      .object({
        evseId: uuid.optional(),
        evseCode: z.string().optional(),
        segment: segmentSchema.default('PUBLIC'),
        at: isoDate.optional(),
      })
      .parse(request.query ?? {});
    const evseId =
      query.evseId ??
      (query.evseCode ? (await getEvseByCode(sql, tenantId, query.evseCode)).evse_uuid : undefined);
    if (!evseId) return { error: { code: 'VALIDATION', message: 'Hace falta evseId o evseCode' } };
    const resolution = await resolveTariff(sql, {
      tenantId,
      evseId,
      segment: query.segment,
      at: date(query.at),
    });
    return serialize(
      resolution.kind === 'TARIFF'
        ? {
            kind: 'TARIFF',
            evseCode: resolution.evse.evse_code,
            segmentRequested: resolution.segmentRequested,
            segmentUsed: resolution.segmentUsed,
            assignment: resolution.assignment,
            tariff: resolution.tariff,
            version: {
              id: resolution.version.id,
              version: resolution.version.version,
              status: resolution.version.status,
              tax_included: resolution.version.tax_included,
            },
            adjustments: resolution.adjustments,
            candidates: resolution.candidates,
            at: resolution.at,
          }
        : {
            kind: 'INTERNAL',
            evseCode: resolution.evse.evse_code,
            candidates: resolution.candidates,
            at: resolution.at,
          },
    );
  });

  // ---- Cotización, simulación y auditoría ----
  app.get('/pricing/quote', async (request) => {
    const query = z
      .object({
        evseCode: z.string().min(1),
        segment: segmentSchema.default('PUBLIC'),
        at: isoDate.optional(),
      })
      .parse(request.query ?? {});
    return quoteEvse(sql, {
      tenantId,
      evseCode: query.evseCode,
      segment: query.segment,
      at: date(query.at),
    });
  });
  app.post('/pricing/simulate', async (request) => {
    const body = simulateBody.parse(request.body);
    const result = await pricing.simulate(sql, {
      ...body,
      events: body.events as Parameters<PricingService['simulate']>[1]['events'],
    });
    const currency = body.tariffVersionId
      ? (await pricing.simulate(sql, body as never)).summary.currency
      : ((body.tariff as { currency?: string } | undefined)?.currency ?? result.summary.currency);
    return toCostResultJson(result, currency);
  });
  app.get('/pricing/audit', async (request) => {
    const query = z
      .object({
        entity: z.string().optional(),
        entityId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query ?? {});
    return { items: serialize(await listTariffAudit(sql, tenantId, query)) };
  });

  // ---- Parámetros ----
  app.get('/parameters', async () => {
    const definitions = await listParamDefinitions(sql);
    const values = await listParamValues(sql);
    return serialize({
      items: definitions.map((definition) => ({
        ...definition,
        values: values.filter((v) => v.key === definition.key),
      })),
    });
  });
  app.get('/parameters/:key/effective', async (request) => {
    const { key } = keyParams.parse(request.params);
    const query = z.object({ connectorId: uuid.optional() }).parse(request.query ?? {});
    return {
      key,
      value: await resolveParam(sql, key, { tenantId, connectorId: query.connectorId }),
    };
  });
  app.put('/parameters/:key', async (request) => {
    const { key } = keyParams.parse(request.params);
    const body = paramBody.parse(request.body);
    return serialize(
      await setParam(sql, {
        key,
        scopeType: body.scopeType,
        scopeId: body.scopeType === 'TENANT' ? tenantId : body.scopeId,
        value: body.value,
        updatedBy: actorOf(request),
        reason: body.reason,
        tenantId,
      }),
    );
  });

  // ---- Costo de sesiones ----
  app.get('/sessions/:id/cost', async (request) => {
    const { id } = idParams.parse(request.params);
    return serialize(await pricing.getSessionCost(sql, id));
  });
  app.post('/sessions/:id/cost/recalculate', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(300) }).parse(request.body);
    const result = await pricing.recalculate(id, { reason: body.reason, actor: actorOf(request) });
    return serialize({ created: result.created, calc: result.calc, lines: result.lines });
  });
  app.post('/sessions/:id/settle', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ force: z.boolean().optional() }).parse(request.body ?? {});
    const outcome = await pricing.settle(id, {
      actor: actorOf(request),
      force: body.force ?? true,
    });
    return serialize(outcome);
  });
}
