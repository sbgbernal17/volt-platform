/**
 * Celular verificado (ADR 0031): normalización a E.164, envío de código con límites de reenvío y de
 * cantidad, verificación con intentos, unicidad del celular verificado y cambio de número.
 */
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeSmsSender } from '../notifications/sms.ts';
import { createDriver } from '../sessions/drivers.ts';
import { VOLT_TENANT_ID } from '../types.ts';
import { anonymizeDriver, updateDriverProfile } from './identity.ts';
import { formatPhone, normalizePhone, PhoneVerificationService } from './phone.ts';

const baseUrl = process.env.DATABASE_URL;

describe('normalización del celular', () => {
  it('acepta las formas habituales en Colombia y devuelve E.164', () => {
    expect(normalizePhone('300 123 4567')).toBe('+573001234567');
    expect(normalizePhone('3001234567')).toBe('+573001234567');
    expect(normalizePhone('(300) 123-4567')).toBe('+573001234567');
    expect(normalizePhone('57 300 123 4567')).toBe('+573001234567');
    expect(normalizePhone('+57 300 123 4567')).toBe('+573001234567');
    expect(normalizePhone('0057 300 123 4567')).toBe('+573001234567');
    expect(normalizePhone('+1 415 555 2671')).toBe('+14155552671');
  });

  it('rechaza números que no son celulares', () => {
    for (const bad of [
      '',
      '123',
      '6041234567',
      '+57 604 123 4567',
      '30012345678',
      '+0 123 4567',
      'abc',
    ]) {
      expect(() => normalizePhone(bad), bad).toThrow(/celular válido/);
    }
  });

  it('formatea para mostrar', () => {
    expect(formatPhone('+573001234567')).toBe('+57 300 123 4567');
    expect(formatPhone('+14155552671')).toBe('+14155552671');
    expect(formatPhone(null)).toBe('');
  });
});

describe.skipIf(!baseUrl)('verificación del celular por SMS', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let clock = new Date('2026-10-01T12:00:00Z');
  const sms = new FakeSmsSender();
  let codes: string[] = [];
  let service: PhoneVerificationService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 2 });
    service = new PhoneVerificationService(sql, {
      sender: sms,
      clock: () => clock,
      codeGenerator: () => codes.shift() ?? '000000',
      maxSendsPerDay: 3,
      maxAttempts: 2,
    });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await database.drop();
  });

  it('envía, limita el reenvío, verifica y deja el celular en la cuenta', async () => {
    const ana = await createDriver(sql, { tenantId: VOLT_TENANT_ID, email: 'ana@example.com' });
    codes = ['123456', '654321', '111111', '222222'];
    const sent = await service.sendCode(ana.id, '300 123 4567', 'es');
    expect(sent).toMatchObject({ phone: '+573001234567', resendAfterS: 60, devCode: '123456' });
    expect(sms.sent.at(-1)).toEqual({
      to: '+573001234567',
      body: 'VOLT: su código de verificación es 123456. Vence en 10 minutos.',
    });
    // Reenvío inmediato: espera.
    await expect(service.sendCode(ana.id, '3001234567')).rejects.toMatchObject({
      code: 'SMS_TOO_SOON',
      status: 429,
    });
    // Código equivocado: descuenta intentos; al agotarlos hay que pedir otro.
    await expect(service.verifyCode(ana.id, '000000')).rejects.toMatchObject({
      code: 'CODE_INVALID',
      details: { attemptsLeft: 1 },
    });
    await expect(service.verifyCode(ana.id, '999999')).rejects.toMatchObject({
      code: 'CODE_INVALID',
      details: { attemptsLeft: 0 },
    });
    await expect(service.verifyCode(ana.id, '123456')).rejects.toMatchObject({
      code: 'CODE_ATTEMPTS',
    });
    clock = new Date(clock.getTime() + 61_000);
    const again = await service.sendCode(ana.id, '3001234567', 'en');
    expect(again.devCode).toBe('654321');
    expect(sms.sent.at(-1)?.body).toContain('your verification code is 654321');
    const driver = await service.verifyCode(ana.id, '654 321');
    expect(driver.phone).toBe('+573001234567');
    expect(driver.phone_verified_at?.toISOString()).toBe(clock.toISOString());
    // El código ya se consumió.
    await expect(service.verifyCode(ana.id, '654321')).rejects.toMatchObject({
      code: 'CODE_EXPIRED',
    });

    // Otra cuenta no puede verificar el mismo número.
    const luis = await createDriver(sql, { tenantId: VOLT_TENANT_ID, email: 'luis@example.com' });
    await expect(service.sendCode(luis.id, '+57 300 123 4567')).rejects.toMatchObject({
      code: 'PHONE_IN_USE',
      status: 409,
    });

    // Cambiar el número desde el perfil deja de estar verificado; verificar otro lo vuelve a marcar.
    const changed = await updateDriverProfile(sql, ana.id, { phone: '301 000 0000' });
    expect(changed).toMatchObject({ phone: '+573010000000', phone_verified_at: null });
    const same = await updateDriverProfile(sql, ana.id, { displayName: 'Ana' });
    expect(same.phone_verified_at).toBeNull();
    await expect(updateDriverProfile(sql, ana.id, { phone: '12' })).rejects.toMatchObject({
      code: 'PHONE_INVALID',
    });
    clock = new Date(clock.getTime() + 61_000);
    await service.sendCode(ana.id, '301 000 0000');
    expect((await service.verifyCode(ana.id, '111111')).phone_verified_at).not.toBeNull();
    // Luis ya puede quedarse con el número anterior.
    const luisSent = await service.sendCode(luis.id, '300 123 4567');
    expect(luisSent.devCode).toBe('222222');
    expect((await service.verifyCode(luis.id, '222222')).phone).toBe('+573001234567');
  });

  it('limita los envíos por día, vence los códigos y borra todo al eliminar la cuenta', async () => {
    const pepe = await createDriver(sql, { tenantId: VOLT_TENANT_ID, email: 'pepe@example.com' });
    codes = ['100000', '200000', '300000', '400000'];
    for (let i = 0; i < 3; i += 1) {
      clock = new Date(clock.getTime() + 61_000);
      await service.sendCode(pepe.id, `302 000 000${i}`);
    }
    clock = new Date(clock.getTime() + 61_000);
    await expect(service.sendCode(pepe.id, '302 000 0009')).rejects.toMatchObject({
      code: 'SMS_LIMIT',
      status: 429,
    });
    // Solo vale el último código y vence a los 10 minutos.
    await expect(service.verifyCode(pepe.id, '100000')).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
    clock = new Date(clock.getTime() + 11 * 60_000);
    await expect(service.verifyCode(pepe.id, '300000')).rejects.toMatchObject({
      code: 'CODE_EXPIRED',
    });
    await anonymizeDriver(sql, pepe.id, { actor: 'test', now: clock });
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM auth.driver_phone_code WHERE driver_id = ${pepe.id}`;
    expect(rows[0]?.n).toBe(0);
  });
});
