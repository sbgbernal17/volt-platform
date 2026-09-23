/**
 * Rutas del personal, el resumen "ahora", la bitácora por cargador, la auditoría y el detalle del
 * conductor (iteración 6). Heredan autenticación, política y auditoría de `adminRoutes`.
 */
import {
  type BillingService,
  createStaffUser,
  getChargePoint,
  getDriver,
  getOverview,
  getStaffUser,
  listAudit,
  listChargePointTimeline,
  listPaymentMethods,
  listSessionViews,
  listStaffUsers,
  STAFF_ROLES,
  TIMELINE_KINDS,
  updateStaffUser,
  verifyAuditChain,
} from '@volt/csms';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { serialize } from './routes.ts';
import { assertInScope, siteScope, staffOf } from './staff-auth.ts';

export interface StaffRoutesOptions {
  sql: Sql;
  tenantId: string;
  billing?: BillingService | undefined;
  /** Datos públicos del proveedor de identidad para la pantalla de entrada del back-office. */
  authConfig: AuthConfig;
}

export interface AuthConfig {
  provider: 'identity-platform' | 'token' | 'none';
  projectId: string | null;
  apiKey: string | null;
  authDomain: string | null;
  tokenLogin: boolean;
}

const uuid = z.string().uuid();
const params = z.object({ id: uuid });
const locale = z.enum(['es', 'en']);

const staffBody = z.object({
  email: z.string().email().max(254),
  displayName: z.string().max(120).optional(),
  role: z.enum(STAFF_ROLES),
  siteIds: z.array(uuid).max(200).optional(),
  locale: locale.optional(),
});

const staffPatch = z.object({
  role: z.enum(STAFF_ROLES).optional(),
  siteIds: z.array(uuid).max(200).optional(),
  displayName: z.string().max(120).nullable().optional(),
  locale: locale.optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  reason: z.string().max(300).optional(),
});

const auditQuery = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(120).optional(),
  actorId: z.string().max(120).optional(),
  action: z.string().max(80).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  beforeId: z.coerce.bigint().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const timelineQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  kinds: z
    .string()
    .transform((value) => value.split(',').filter((k) => k))
    .pipe(z.array(z.enum(TIMELINE_KINDS)))
    .optional(),
  ocppDays: z.coerce.number().int().min(1).max(90).optional(),
});

function publicStaff<T extends { idp_subject: string | null }>(
  row: T,
): Omit<T, 'idp_subject'> & {
  linked: boolean;
} {
  const { idp_subject, ...rest } = row;
  return { ...rest, linked: idp_subject !== null };
}

export async function staffRoutes(
  app: FastifyInstance,
  options: StaffRoutesOptions,
): Promise<void> {
  const { sql, tenantId } = options;

  app.get('/me', async (request) => {
    const staff = staffOf(request);
    return {
      id: staff.id,
      actor: staff.actor,
      tenantId: staff.tenantId,
      role: staff.role,
      permissions: [...staff.permissions],
      siteIds: staff.siteIds,
      email: staff.email,
      displayName: staff.displayName,
      locale: staff.locale,
      mfa: staff.mfa,
      method: staff.method,
      authTime: staff.authTime?.toISOString() ?? null,
    };
  });

  app.get('/overview', async (request) =>
    serialize(await getOverview(sql, tenantId, siteScope(request))),
  );

  app.get('/charge-points/:id/timeline', async (request) => {
    const { id } = params.parse(request.params);
    const chargePoint = await getChargePoint(sql, id);
    assertInScope(request, chargePoint.site_id);
    const query = timelineQuery.parse(request.query ?? {});
    const items = await listChargePointTimeline(sql, id, {
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
      kinds: query.kinds,
      ocppDays: query.ocppDays,
    });
    return { chargeBoxId: chargePoint.charge_box_id, items: serialize(items) };
  });

  // ---- Personal ----
  app.get('/staff', async () => ({
    items: (await listStaffUsers(sql, tenantId)).map(publicStaff),
  }));
  app.post('/staff', async (request, reply) => {
    const body = staffBody.parse(request.body);
    const created = await createStaffUser(sql, {
      tenantId,
      email: body.email,
      role: body.role,
      displayName: body.displayName,
      siteIds: body.siteIds,
      locale: body.locale,
      invitedBy: staffOf(request).actor,
    });
    reply.code(201);
    return publicStaff(created);
  });
  app.get('/staff/:id', async (request) =>
    publicStaff(await getStaffUser(sql, params.parse(request.params).id)),
  );
  app.patch('/staff/:id', async (request) => {
    const { id } = params.parse(request.params);
    const body = staffPatch.parse(request.body);
    return publicStaff(await updateStaffUser(sql, id, body, staffOf(request).id));
  });

  // ---- Auditoría ----
  app.get('/audit', async (request) => {
    const query = auditQuery.parse(request.query ?? {});
    const items = await listAudit(sql, {
      tenantId,
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      beforeId: query.beforeId,
      limit: query.limit,
    });
    return {
      items: items.map((row) => ({
        ...serialize({ ...row, prev_hash: undefined, hash: undefined }),
        id: row.id.toString(),
        hash: Buffer.from(row.hash).toString('hex'),
        prevHash: Buffer.from(row.prev_hash).toString('hex'),
      })),
    };
  });
  app.post('/audit/verify', async () => {
    const result = await verifyAuditChain(sql);
    return {
      ...result,
      brokenAtId: result.brokenAtId?.toString() ?? null,
      lastId: result.lastId?.toString() ?? null,
    };
  });

  // ---- Conductor (detalle para soporte; acceso auditado) ----
  app.get('/drivers/:id', async (request) => {
    const { id } = params.parse(request.params);
    const [driver, paymentMethods, sessions] = await Promise.all([
      getDriver(sql, id),
      listPaymentMethods(sql, id),
      listSessionViews(sql, { tenantId, driverId: id, limit: 20 }),
    ]);
    const debts = options.billing
      ? await options.billing.listDebts({ tenantId, driverId: id })
      : [];
    return serialize({
      ...driver,
      paymentMethods: paymentMethods.map((m) => ({ ...m, psp_method_id: undefined })),
      sessions,
      debts,
    });
  });
}

/** Ruta pública (sin autenticación) con la configuración del proveedor de identidad del back-office. */
export async function authConfigRoute(
  app: FastifyInstance,
  options: { authConfig: AuthConfig },
): Promise<void> {
  app.get('/auth/config', async () => options.authConfig);
}
