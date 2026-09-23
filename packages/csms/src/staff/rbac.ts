/**
 * RBAC del back-office (FUN M13, SEG §3.2, ADR 0004 y 0021): roles fijos del MVP con permisos por
 * área y verbo. La decisión final la toma siempre la API con esta política central; el cliente solo
 * usa la lista para mostrar u ocultar acciones.
 */
export const STAFF_ROLES = ['ADMIN', 'OPERATIONS', 'SUPPORT', 'READ_ONLY', 'SITE_OWNER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  'overview:read',
  'inventory:read',
  'inventory:write',
  'commissioning:execute',
  'config:write',
  'commands:execute',
  'commands:support',
  'sessions:read',
  'sessions:operate',
  'drivers:read',
  'drivers:write',
  'pricing:read',
  'pricing:write',
  'pricing:publish',
  'params:read',
  'params:write',
  'billing:read',
  'billing:operate',
  'billing:refund',
  'alarms:read',
  'alarms:resolve',
  'audit:read',
  'staff:read',
  'staff:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READS: Permission[] = [
  'overview:read',
  'inventory:read',
  'sessions:read',
  'drivers:read',
  'pricing:read',
  'params:read',
  'billing:read',
  'alarms:read',
  'audit:read',
  'staff:read',
];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  OPERATIONS: [
    ...READS,
    'inventory:write',
    'commissioning:execute',
    'config:write',
    'commands:execute',
    'commands:support',
    'sessions:operate',
    'params:write',
    'alarms:resolve',
  ],
  SUPPORT: [
    'overview:read',
    'inventory:read',
    'sessions:read',
    'sessions:operate',
    'drivers:read',
    'drivers:write',
    'pricing:read',
    'params:read',
    'billing:read',
    'billing:operate',
    'billing:refund',
    'alarms:read',
    'commands:support',
  ],
  READ_ONLY: READS,
  SITE_OWNER: ['overview:read', 'inventory:read', 'sessions:read', 'alarms:read'],
};

/** Acciones OCPP que el rol SUPPORT puede enviar (runbooks RB-02/03/04, OPS §6). */
export const SUPPORT_ACTIONS = [
  'RemoteStopTransaction',
  'UnlockConnector',
  'TriggerMessage',
] as const;

/** Roles cuyo alcance se limita a `site_ids` (ADR 0004). */
export const SCOPED_ROLES: readonly StaffRole[] = ['SITE_OWNER'];

export function permissionsForRole(role: StaffRole): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}
