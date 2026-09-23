import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { raiseAlarm } from '../alarms.ts';
import { ConflictError, ForbiddenError } from '../errors.ts';
import { createChargePoint, createSite } from '../inventory.ts';
import { transitionLifecycle } from '../lifecycle.ts';
import { VOLT_TENANT_ID } from '../types.ts';
import { appendAudit, canonicalJson, listAudit, verifyAuditChain } from './audit.ts';
import { getOverview } from './overview.ts';
import { permissionsForRole } from './rbac.ts';
import {
  bindStaffIdentity,
  bootstrapFirstAdmin,
  createStaffUser,
  findStaffBySubject,
  listStaffUsers,
  recordStaffLogin,
  updateStaffUser,
} from './staff.ts';
import { listChargePointTimeline } from './timeline.ts';

const baseUrl = process.env.DATABASE_URL;

describe('RBAC', () => {
  it('cada rol tiene los permisos del diseño', () => {
    expect(permissionsForRole('ADMIN').has('staff:manage')).toBe(true);
    expect(permissionsForRole('OPERATIONS').has('staff:manage')).toBe(false);
    expect(permissionsForRole('OPERATIONS').has('commands:execute')).toBe(true);
    expect(permissionsForRole('SUPPORT').has('commands:execute')).toBe(false);
    expect(permissionsForRole('SUPPORT').has('commands:support')).toBe(true);
    expect(permissionsForRole('READ_ONLY').has('sessions:operate')).toBe(false);
    expect(permissionsForRole('READ_ONLY').has('audit:read')).toBe(true);
    expect(permissionsForRole('SITE_OWNER').has('pricing:read')).toBe(false);
  });

  it('el JSON canónico ordena claves y omite undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [3, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe.skipIf(!baseUrl)('personal y auditoría (base de datos)', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let adminId = '';
  let siteId = '';
  let chargePointId = '';

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 2 });
    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'SEDE-STAFF',
      name: 'Sede staff',
      address: 'Calle 1',
      latitude: 4.7,
      longitude: -74.07,
      timezone: 'America/Bogota',
    });
    siteId = site.id;
    const cp = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId,
      chargeBoxId: 'CP-STAFF-1',
      connectors: [{ ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC' }],
    });
    chargePointId = cp.id;
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await database?.drop();
  });

  it('invita, vincula la identidad solo con correo verificado y protege al último administrador', async () => {
    const first = await bootstrapFirstAdmin(sql, VOLT_TENANT_ID, 'Dueno@Volt.co');
    expect(first?.email).toBe('dueno@volt.co');
    expect(first?.status).toBe('INVITED');
    adminId = first?.id as string;
    expect(await bootstrapFirstAdmin(sql, VOLT_TENANT_ID, 'otro@volt.co')).toBeUndefined();
    await expect(
      createStaffUser(sql, {
        tenantId: VOLT_TENANT_ID,
        email: 'DUENO@volt.co',
        role: 'ADMIN',
        invitedBy: 'staff:admin-token',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createStaffUser(sql, {
        tenantId: VOLT_TENANT_ID,
        email: 'socio@volt.co',
        role: 'SITE_OWNER',
        invitedBy: 'staff:admin-token',
      }),
    ).rejects.toThrow(/sede/);

    await expect(
      bindStaffIdentity(sql, {
        subject: 'uid-1',
        email: 'dueno@volt.co',
        emailVerified: false,
        provider: 'password',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    await expect(
      bindStaffIdentity(sql, {
        subject: 'uid-x',
        email: 'nadie@volt.co',
        emailVerified: true,
        provider: 'password',
      }),
    ).rejects.toMatchObject({ code: 'STAFF_NOT_INVITED' });
    const bound = await bindStaffIdentity(sql, {
      subject: 'uid-1',
      email: 'dueno@volt.co',
      emailVerified: true,
      provider: 'password',
    });
    expect(bound.status).toBe('ACTIVE');
    expect(bound.idp_subject).toBe('uid-1');
    // Otra identidad con el mismo correo no puede apropiarse de la cuenta.
    await expect(
      bindStaffIdentity(sql, {
        subject: 'uid-2',
        email: 'dueno@volt.co',
        emailVerified: true,
        provider: 'google.com',
      }),
    ).rejects.toMatchObject({ code: 'STAFF_ALREADY_BOUND' });
    expect((await findStaffBySubject(sql, 'uid-1'))?.id).toBe(adminId);
    await recordStaffLogin(sql, adminId, true);
    expect((await findStaffBySubject(sql, 'uid-1'))?.mfa_enrolled).toBe(true);

    await expect(
      updateStaffUser(sql, adminId, { role: 'READ_ONLY' }, adminId),
    ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(
      updateStaffUser(sql, adminId, { status: 'DISABLED' }, adminId),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const ops = await createStaffUser(sql, {
      tenantId: VOLT_TENANT_ID,
      email: 'ops@volt.co',
      role: 'OPERATIONS',
      displayName: 'Operaciones',
      invitedBy: `staff:${adminId}`,
    });
    const owner = await updateStaffUser(
      sql,
      ops.id,
      { role: 'SITE_OWNER', siteIds: [siteId] },
      adminId,
    );
    expect(owner.site_ids).toEqual([siteId]);
    const disabled = await updateStaffUser(
      sql,
      ops.id,
      { status: 'DISABLED', reason: 'salió de la empresa' },
      adminId,
    );
    expect(disabled.status).toBe('DISABLED');
    expect(disabled.disabled_reason).toBe('salió de la empresa');
    const reenabled = await updateStaffUser(sql, ops.id, { status: 'ACTIVE' }, adminId);
    expect(reenabled.status).toBe('INVITED'); // sin identidad vinculada vuelve a INVITED
    expect((await listStaffUsers(sql, VOLT_TENANT_ID)).map((s) => s.email)).toEqual([
      'dueno@volt.co',
      'ops@volt.co',
    ]);
  });

  it('la auditoría encadena hashes, es inmutable y detecta alteraciones', async () => {
    const a = await appendAudit(sql, {
      tenantId: VOLT_TENANT_ID,
      actorType: 'staff',
      actorId: `staff:${adminId}`,
      action: 'command.send',
      entityType: 'charge_point',
      entityId: chargePointId,
      after: { action: 'Reset', payload: { type: 'Soft' }, ñ: 'señal' },
      requestId: 'req-1',
      remoteIp: '10.0.0.1',
      userAgent: 'vitest',
    });
    const b = await appendAudit(sql, {
      tenantId: VOLT_TENANT_ID,
      actorType: 'system',
      actorId: 'system:test',
      action: 'tariff.publish',
      entityType: 'tariff',
      entityId: 't-1',
      before: { version: 1 },
      after: { version: 2, price: '1350', at: new Date('2026-09-22T10:00:00Z') },
    });
    expect(Buffer.from(b.prev_hash).equals(Buffer.from(a.hash))).toBe(true);
    expect(Buffer.from(a.prev_hash).equals(Buffer.alloc(32, 0))).toBe(true);
    // Escrituras concurrentes no bifurcan la cadena.
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        appendAudit(sql, {
          actorType: 'system',
          actorId: 'system:test',
          action: `x.${i}`,
          entityType: 'x',
          entityId: String(i),
        }),
      ),
    );
    const verified = await verifyAuditChain(sql);
    expect(verified).toMatchObject({ ok: true, checked: 7, brokenAtId: null });
    const listed = await listAudit(sql, { action: 'command.', entityId: chargePointId });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.after).toEqual({ action: 'Reset', payload: { type: 'Soft' }, ñ: 'señal' });

    await expect(
      sql`UPDATE audit.audit_log SET action = 'otra' WHERE id = ${a.id.toString()}::bigint`,
    ).rejects.toThrow(/inmutable/);
    await expect(sql`DELETE FROM audit.audit_log`).rejects.toThrow(/inmutable/);
    // Si alguien desactiva el trigger y altera una fila, la verificación lo detecta.
    await sql`ALTER TABLE audit.audit_log DISABLE TRIGGER audit_log_immutable`;
    await sql`UPDATE audit.audit_log SET entity_id = 't-9' WHERE id = ${b.id.toString()}::bigint`;
    await sql`ALTER TABLE audit.audit_log ENABLE TRIGGER audit_log_immutable`;
    const broken = await verifyAuditChain(sql);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAtId).toBe(b.id);
    expect(broken.checked).toBe(1);
  });

  it('arma la bitácora del cargador y el resumen por sedes', async () => {
    await transitionLifecycle(sql, {
      chargePointId,
      to: 'PROVISIONED',
      actor: `staff:${adminId}`,
      evidence: { via: 'test' },
    });
    await raiseAlarm(sql, {
      tenantId: VOLT_TENANT_ID,
      kind: 'CHARGER_OFFLINE',
      severity: 'WARNING',
      fingerprint: 'CHARGER_OFFLINE|CP-STAFF-1',
      siteId,
      chargePointId,
      details: {},
    });
    const timeline = await listChargePointTimeline(sql, chargePointId);
    expect(timeline.map((e) => e.kind).sort()).toEqual(['ALARM', 'LIFECYCLE', 'LIFECYCLE']);
    const onlyAlarms = await listChargePointTimeline(sql, chargePointId, { kinds: ['ALARM'] });
    expect(onlyAlarms).toHaveLength(1);
    expect(onlyAlarms[0]?.title).toBe('CHARGER_OFFLINE');

    const overview = await getOverview(sql, VOLT_TENANT_ID);
    expect(overview.counts).toMatchObject({ sites: 1, chargePoints: 1, offline: 1 });
    expect(overview.counts.connectorsByStatus).toEqual({ Offline: 1 });
    expect(overview.counts.openAlarms.WARNING).toBe(1);
    expect(overview.sites[0]?.chargePoints[0]?.connectors).toHaveLength(1);
    const scoped = await getOverview(sql, VOLT_TENANT_ID, ['00000000-0000-4000-8000-000000000000']);
    expect(scoped.counts).toMatchObject({ sites: 0, chargePoints: 0 });
    expect(scoped.openAlarms).toHaveLength(0);
  });
});
