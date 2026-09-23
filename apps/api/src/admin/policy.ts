/**
 * Política central de acceso del back-office (SEG §3.2): cada ruta de /admin/v1 declara el permiso
 * que exige y, si cambia estado o accede a datos personales, cómo se audita. Una ruta sin entrada se
 * rechaza (403 NO_POLICY): la omisión nunca abre acceso.
 */
import type { Permission } from '@volt/csms';

export interface AuditSpec {
  /** Nombre de la acción auditada, p. ej. `command.send`. */
  action: string;
  /** Tipo de entidad auditada. */
  entity: string;
  /** De dónde sale el id de la entidad; por defecto `params.id`, luego `params.key`, luego `body.id` de la respuesta. */
  idFrom?: 'params:id' | 'params:key' | 'response:id' | undefined;
}

export interface RoutePolicy {
  permission: Permission | 'any';
  audit?: AuditSpec | undefined;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const audit = (action: string, entity: string, idFrom?: AuditSpec['idFrom']): AuditSpec => ({
  action,
  entity,
  idFrom,
});

/** Clave: `MÉTODO /ruta` relativa al prefijo /admin/v1, con los parámetros de Fastify (`:id`). */
export const ADMIN_POLICY: Record<`${Method} ${string}`, RoutePolicy> = {
  // ---- Sesión del personal, resumen y bitácora ----
  'GET /me': { permission: 'any' },
  'GET /overview': { permission: 'overview:read' },
  'GET /charge-points/:id/timeline': { permission: 'inventory:read' },
  // ---- Personal ----
  'GET /staff': { permission: 'staff:read' },
  'POST /staff': {
    permission: 'staff:manage',
    audit: audit('staff.invite', 'staff_user', 'response:id'),
  },
  'GET /staff/:id': { permission: 'staff:read' },
  'PATCH /staff/:id': { permission: 'staff:manage', audit: audit('staff.update', 'staff_user') },
  // ---- Auditoría ----
  'GET /audit': { permission: 'audit:read' },
  'POST /audit/verify': { permission: 'audit:read' },
  // ---- Sedes ----
  'GET /sites': { permission: 'inventory:read' },
  'POST /sites': {
    permission: 'inventory:write',
    audit: audit('site.create', 'site', 'response:id'),
  },
  'GET /sites/:id': { permission: 'inventory:read' },
  // ---- Plantillas ----
  'GET /config-templates': { permission: 'inventory:read' },
  'POST /config-templates': {
    permission: 'inventory:write',
    audit: audit('config_template.create', 'config_template', 'response:id'),
  },
  'GET /config-templates/:id': { permission: 'inventory:read' },
  // ---- Cargadores ----
  'GET /charge-points': { permission: 'inventory:read' },
  'POST /charge-points': {
    permission: 'inventory:write',
    audit: audit('charge_point.create', 'charge_point', 'response:id'),
  },
  'GET /charge-points/:id': { permission: 'inventory:read' },
  'POST /charge-points/:id/credentials': {
    permission: 'commissioning:execute',
    audit: audit('credential.issue', 'charge_point'),
  },
  'PUT /charge-points/:id/template': {
    permission: 'inventory:write',
    audit: audit('charge_point.template.assign', 'charge_point'),
  },
  'POST /charge-points/:id/lifecycle': {
    permission: 'inventory:write',
    audit: audit('charge_point.lifecycle', 'charge_point'),
  },
  'GET /charge-points/:id/lifecycle-events': { permission: 'inventory:read' },
  'GET /charge-points/:id/configuration': { permission: 'inventory:read' },
  'POST /charge-points/:id/commission': {
    permission: 'commissioning:execute',
    audit: audit('charge_point.commission', 'charge_point'),
  },
  'POST /charge-points/:id/configuration/sync': {
    permission: 'commissioning:execute',
    audit: audit('charge_point.config.sync', 'charge_point'),
  },
  'PUT /charge-points/:id/configuration/:key': {
    permission: 'config:write',
    audit: audit('charge_point.config.override', 'charge_point'),
  },
  'POST /charge-points/:id/commands': {
    permission: 'commands:support',
    audit: audit('command.send', 'charge_point'),
  },
  'GET /charge-points/:id/commands': { permission: 'inventory:read' },
  'GET /charge-points/:id/transactions': { permission: 'sessions:read' },
  // ---- Alarmas ----
  'GET /alarms': { permission: 'alarms:read' },
  'POST /alarms/:id/resolve': {
    permission: 'alarms:resolve',
    audit: audit('alarm.resolve', 'alarm'),
  },
  // ---- Conductores (datos personales: la lectura de detalle se audita) ----
  'GET /drivers': { permission: 'drivers:read' },
  'POST /drivers': {
    permission: 'drivers:write',
    audit: audit('driver.create', 'driver', 'response:id'),
  },
  'GET /drivers/:id': { permission: 'drivers:read', audit: audit('driver.read', 'driver') },
  'GET /drivers/:id/payment-methods': {
    permission: 'drivers:read',
    audit: audit('driver.payment_methods.read', 'driver'),
  },
  'POST /drivers/:id/block': {
    permission: 'billing:operate',
    audit: audit('driver.block', 'driver'),
  },
  'POST /drivers/:id/unblock': {
    permission: 'billing:operate',
    audit: audit('driver.unblock', 'driver'),
  },
  // ---- Sesiones ----
  'POST /sessions': {
    permission: 'sessions:operate',
    audit: audit('session.start', 'session', 'response:id'),
  },
  'GET /sessions': { permission: 'sessions:read' },
  'GET /sessions/:id': { permission: 'sessions:read' },
  'POST /sessions/:id/stop': {
    permission: 'sessions:operate',
    audit: audit('session.stop', 'session'),
  },
  'POST /sessions/:id/cancel': {
    permission: 'sessions:operate',
    audit: audit('session.cancel', 'session'),
  },
  'GET /sessions/:id/events': { permission: 'sessions:read' },
  'GET /sessions/:id/cost': { permission: 'sessions:read' },
  'POST /sessions/:id/cost/recalculate': {
    permission: 'sessions:operate',
    audit: audit('session.cost.recalculate', 'session'),
  },
  'POST /sessions/:id/settle': {
    permission: 'sessions:operate',
    audit: audit('session.settle', 'session'),
  },
  'POST /sessions/:id/charge': {
    permission: 'billing:operate',
    audit: audit('session.charge', 'session'),
  },
  'GET /sessions/:id/receipt': { permission: 'billing:read' },
  // ---- Tarifas ----
  'GET /tariffs': { permission: 'pricing:read' },
  'POST /tariffs': {
    permission: 'pricing:write',
    audit: audit('tariff.create', 'tariff', 'response:id'),
  },
  'POST /tariffs/bootstrap': {
    permission: 'pricing:write',
    audit: audit('tariff.bootstrap', 'tariff', 'response:id'),
  },
  'POST /tariffs/activate-scheduled': {
    permission: 'pricing:publish',
    audit: audit('tariff.activate_scheduled', 'tariff'),
  },
  'GET /tariffs/:id': { permission: 'pricing:read' },
  'POST /tariffs/:id/versions/validate': { permission: 'pricing:read' },
  'POST /tariffs/:id/versions': {
    permission: 'pricing:write',
    audit: audit('tariff.version.create', 'tariff'),
  },
  'GET /tariffs/:id/versions/:version': { permission: 'pricing:read' },
  'POST /tariffs/:id/versions/:version/publish': {
    permission: 'pricing:publish',
    audit: audit('tariff.publish', 'tariff'),
  },
  'POST /tariffs/:id/versions/:version/retire': {
    permission: 'pricing:publish',
    audit: audit('tariff.retire', 'tariff'),
  },
  'GET /tariff-assignments': { permission: 'pricing:read' },
  'POST /tariff-assignments': {
    permission: 'pricing:publish',
    audit: audit('tariff.assignment.create', 'tariff_assignment', 'response:id'),
  },
  'POST /tariff-assignments/:id/end': {
    permission: 'pricing:publish',
    audit: audit('tariff.assignment.end', 'tariff_assignment'),
  },
  'GET /tariff-assignments/resolve': { permission: 'pricing:read' },
  'GET /pricing/quote': { permission: 'pricing:read' },
  'POST /pricing/simulate': { permission: 'pricing:read' },
  'GET /pricing/audit': { permission: 'pricing:read' },
  // ---- Parámetros ----
  'GET /parameters': { permission: 'params:read' },
  'GET /parameters/:key/effective': { permission: 'params:read' },
  'PUT /parameters/:key': {
    permission: 'params:write',
    audit: audit('param.set', 'parameter', 'params:key'),
  },
  // ---- Pagos ----
  'GET /payments': { permission: 'billing:read' },
  'GET /payments/:id': { permission: 'billing:read' },
  'POST /payments/:id/reverse': {
    permission: 'billing:refund',
    audit: audit('payment.reverse', 'payment'),
  },
  'GET /debts': { permission: 'billing:read' },
  'GET /debts/:id': { permission: 'billing:read' },
  'POST /debts/:id/pay-link': {
    permission: 'billing:operate',
    audit: audit('debt.pay_link', 'debt'),
  },
  'POST /debts/:id/waive': { permission: 'billing:refund', audit: audit('debt.waive', 'debt') },
  'POST /debts/:id/retry': { permission: 'billing:operate', audit: audit('debt.retry', 'debt') },
  'GET /billing/webhooks': { permission: 'billing:read' },
  'POST /billing/reconcile': {
    permission: 'billing:operate',
    audit: audit('billing.reconcile', 'billing'),
  },
  'POST /billing/jobs/run': {
    permission: 'billing:operate',
    audit: audit('billing.jobs.run', 'billing'),
  },
};

export const ADMIN_PREFIX = '/admin/v1';

/** Política de una ruta a partir del método y del patrón de ruta de Fastify (`request.routeOptions.url`). */
export function policyFor(method: string, routeUrl: string | undefined): RoutePolicy | undefined {
  if (!routeUrl) return undefined;
  const relative = routeUrl.startsWith(ADMIN_PREFIX)
    ? routeUrl.slice(ADMIN_PREFIX.length)
    : routeUrl;
  const key = `${method.toUpperCase()} ${relative || '/'}` as keyof typeof ADMIN_POLICY;
  return ADMIN_POLICY[key];
}
