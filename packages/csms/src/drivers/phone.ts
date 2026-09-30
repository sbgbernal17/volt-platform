/**
 * Celular verificado del conductor (ADR 0031): el número se normaliza a E.164, se envía un código de
 * un solo uso por SMS y se confirma con límites de reenvío e intentos. Solo se guarda el hash del
 * código (con sal); el número queda verificado en `auth.driver.phone_verified_at` y no puede estar
 * verificado en dos cuentas activas a la vez.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ISql } from 'postgres';
import { ConflictError, CsmsError, NotFoundError } from '../errors.ts';
import type { SmsSender } from '../notifications/sms.ts';
import type { DriverRow } from '../sessions/drivers.ts';

export class PhoneInvalidError extends CsmsError {
  constructor(
    message = 'Escriba un celular válido (10 dígitos que empiecen por 3, o con el indicativo del país)',
  ) {
    super(message, 400, 'PHONE_INVALID');
  }
}

/** Indicativo por defecto: Colombia. Los celulares colombianos tienen 10 dígitos y empiezan por 3. */
export const DEFAULT_COUNTRY_CODE = '57';

/**
 * Normaliza a E.164: acepta "300 123 4567", "3001234567", "57 300…", "+57 300…", "0057…" y números
 * internacionales con `+`. Lanza PhoneInvalidError si no es un número plausible.
 */
export function normalizePhone(input: string, countryCode = DEFAULT_COUNTRY_CODE): string {
  const trimmed = input.trim();
  if (!trimmed) throw new PhoneInvalidError();
  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  const digits = trimmed.replace(/\D/g, '').replace(/^00/, international ? '' : '00');
  let national: string;
  let code: string;
  if (international) {
    if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) {
      throw new PhoneInvalidError();
    }
    if (digits.startsWith(countryCode)) {
      code = countryCode;
      national = digits.slice(countryCode.length);
    } else {
      return `+${digits}`;
    }
  } else if (digits.length === 10) {
    code = countryCode;
    national = digits;
  } else if (digits.length === 12 && digits.startsWith(countryCode)) {
    code = countryCode;
    national = digits.slice(2);
  } else {
    throw new PhoneInvalidError();
  }
  if (code === '57' && !/^3\d{9}$/.test(national)) throw new PhoneInvalidError();
  return `+${code}${national}`;
}

/** "+573001234567" → "+57 300 123 4567" (Colombia); otros países se muestran tal cual. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  if (/^\+573\d{9}$/.test(e164)) {
    return `+57 ${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`;
  }
  return e164;
}

export const SMS_TEXTS: Record<'es' | 'en', (code: string, minutes: number) => string> = {
  es: (code, minutes) => `VOLT: su código de verificación es ${code}. Vence en ${minutes} minutos.`,
  en: (code, minutes) =>
    `VOLT: your verification code is ${code}. It expires in ${minutes} minutes.`,
};

export interface PhoneVerificationOptions {
  sender: SmsSender;
  /** Vigencia del código en segundos (por defecto 10 minutos). */
  codeTtlS?: number | undefined;
  /** Espera mínima entre envíos al mismo conductor (por defecto 60 s). */
  resendAfterS?: number | undefined;
  /** Envíos máximos por conductor y por número en 24 horas (por defecto 5). */
  maxSendsPerDay?: number | undefined;
  /** Intentos de código por envío (por defecto 5). */
  maxAttempts?: number | undefined;
  clock?: (() => Date) | undefined;
  /** Generador del código (pruebas). */
  codeGenerator?: (() => string) | undefined;
}

export interface PhoneCodeSent {
  phone: string;
  expiresAt: Date;
  resendAfterS: number;
  /** Código en claro solo con el emulador de SMS (ambientes sin proveedor); nunca en producción. */
  devCode: string | null;
}

interface PhoneCodeRow {
  id: string;
  driver_id: string;
  phone: string;
  code_hash: string;
  salt: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

function hashCode(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

export class PhoneVerificationService {
  private readonly sender: SmsSender;
  private readonly codeTtlS: number;
  private readonly resendAfterS: number;
  private readonly maxSendsPerDay: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private readonly generate: () => string;

  constructor(
    private readonly db: ISql,
    options: PhoneVerificationOptions,
  ) {
    this.sender = options.sender;
    this.codeTtlS = options.codeTtlS ?? 600;
    this.resendAfterS = options.resendAfterS ?? 60;
    this.maxSendsPerDay = options.maxSendsPerDay ?? 5;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.now = options.clock ?? (() => new Date());
    this.generate =
      options.codeGenerator ?? (() => String(randomInt(0, 1_000_000)).padStart(6, '0'));
  }

  /** Envía un código al número (normalizado) y lo deja pendiente para el conductor. */
  async sendCode(
    driverId: string,
    rawPhone: string,
    locale: 'es' | 'en' = 'es',
  ): Promise<PhoneCodeSent> {
    const phone = normalizePhone(rawPhone);
    const now = this.now();
    const driver = (
      await this.db<DriverRow[]>`
        SELECT * FROM auth.driver WHERE id = ${driverId} AND anonymized_at IS NULL`
    )[0];
    if (!driver) throw new NotFoundError('driver', driverId);
    await this.assertPhoneFree(driver, phone);
    const recent = await this.db<{ last: Date | null; day: number; phone_day: number }[]>`
      SELECT
        (SELECT max(created_at) FROM auth.driver_phone_code WHERE driver_id = ${driverId}) AS last,
        (SELECT count(*)::int FROM auth.driver_phone_code WHERE driver_id = ${driverId} AND created_at > ${now} - interval '24 hours') AS day,
        (SELECT count(*)::int FROM auth.driver_phone_code WHERE phone = ${phone} AND created_at > ${now} - interval '24 hours') AS phone_day`;
    const stats = recent[0];
    if (stats?.last) {
      const elapsedS = (now.getTime() - stats.last.getTime()) / 1000;
      if (elapsedS < this.resendAfterS) {
        throw new CsmsError('Espere un momento antes de pedir otro código', 429, 'SMS_TOO_SOON', {
          retryAfterS: Math.ceil(this.resendAfterS - elapsedS),
        });
      }
    }
    if (
      (stats?.day ?? 0) >= this.maxSendsPerDay ||
      (stats?.phone_day ?? 0) >= this.maxSendsPerDay
    ) {
      throw new CsmsError(
        'Se alcanzó el máximo de códigos por hoy; intente mañana o escriba a soporte',
        429,
        'SMS_LIMIT',
      );
    }
    const code = this.generate();
    const salt = randomBytes(8).toString('hex');
    const expiresAt = new Date(now.getTime() + this.codeTtlS * 1000);
    await this.db`
      UPDATE auth.driver_phone_code SET consumed_at = ${now}
      WHERE driver_id = ${driverId} AND consumed_at IS NULL`;
    await this.db`
      INSERT INTO auth.driver_phone_code (id, tenant_id, driver_id, phone, code_hash, salt, expires_at, created_at)
      VALUES (${randomUUID()}, ${driver.tenant_id}, ${driverId}, ${phone}, ${hashCode(code, salt)}, ${salt}, ${expiresAt}, ${now})`;
    await this.sender.send({
      to: phone,
      body: SMS_TEXTS[locale](code, Math.round(this.codeTtlS / 60)),
    });
    return {
      phone,
      expiresAt,
      resendAfterS: this.resendAfterS,
      devCode: this.sender.provider === 'fake' ? code : null,
    };
  }

  /** Comprueba el código pendiente del conductor y deja el celular verificado. */
  async verifyCode(driverId: string, rawCode: string): Promise<DriverRow> {
    const code = rawCode.replace(/\D/g, '');
    const now = this.now();
    const pending = (
      await this.db<PhoneCodeRow[]>`
        SELECT * FROM auth.driver_phone_code
        WHERE driver_id = ${driverId} AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`
    )[0];
    if (!pending || pending.expires_at <= now) {
      throw new CsmsError('El código venció; pida uno nuevo', 400, 'CODE_EXPIRED');
    }
    if (pending.attempts >= this.maxAttempts) {
      throw new CsmsError('Demasiados intentos; pida un código nuevo', 400, 'CODE_ATTEMPTS');
    }
    const expected = Buffer.from(pending.code_hash, 'hex');
    const presented = Buffer.from(hashCode(code, pending.salt), 'hex');
    if (
      code.length !== 6 ||
      expected.length !== presented.length ||
      !timingSafeEqual(expected, presented)
    ) {
      const attempts = pending.attempts + 1;
      await this
        .db`UPDATE auth.driver_phone_code SET attempts = ${attempts} WHERE id = ${pending.id}`;
      throw new CsmsError('El código no coincide', 400, 'CODE_INVALID', {
        attemptsLeft: Math.max(0, this.maxAttempts - attempts),
      });
    }
    const driver = (
      await this.db<DriverRow[]>`
        SELECT * FROM auth.driver WHERE id = ${driverId} AND anonymized_at IS NULL`
    )[0];
    if (!driver) throw new NotFoundError('driver', driverId);
    await this.assertPhoneFree(driver, pending.phone);
    try {
      const rows = await this.db<DriverRow[]>`
        UPDATE auth.driver SET phone = ${pending.phone}, phone_verified_at = ${now}, updated_at = now()
        WHERE id = ${driverId} RETURNING *`;
      await this
        .db`UPDATE auth.driver_phone_code SET consumed_at = ${now} WHERE id = ${pending.id}`;
      return rows[0] as DriverRow;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictError('Ese celular ya está verificado en otra cuenta', 'PHONE_IN_USE');
      }
      throw error;
    }
  }

  private async assertPhoneFree(driver: DriverRow, phone: string): Promise<void> {
    const clash = await this.db`
      SELECT 1 FROM auth.driver
      WHERE tenant_id = ${driver.tenant_id} AND phone = ${phone} AND phone_verified_at IS NOT NULL
        AND anonymized_at IS NULL AND id <> ${driver.id} LIMIT 1`;
    if (clash.length > 0) {
      throw new ConflictError('Ese celular ya está verificado en otra cuenta', 'PHONE_IN_USE');
    }
  }
}
