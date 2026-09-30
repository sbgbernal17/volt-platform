/**
 * Correos de identidad con la marca (ADR 0032): la plataforma genera el enlace de Identity Platform
 * y lo envía en el cuerpo HTML propio (botón "Confirmar correo" o "Crear contraseña nueva"). Con
 * proveedor de correo configurado la app usa estas rutas; sin él, el SDK de Firebase envía el correo
 * genérico de Google. Límites en memoria por conductor, por correo y por IP.
 */
import {
  CsmsError,
  DRIVER_LOCALES,
  EMAIL_TEMPLATES,
  type EmailSender,
  getDriver,
  renderEmail,
} from '@volt/csms';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { IdentityLinkError, type IdentityLinkGenerator } from '../notifications/identity-links.ts';
import { RateLimiter } from '../notifications/rate-limit.ts';
import { driverOf } from './auth.ts';

export interface AuthEmailOptions {
  sql: Sql;
  email: EmailSender;
  links: IdentityLinkGenerator;
  /** URL pública de la app web: host del logotipo y `continueUrl` de los enlaces. */
  appWebUrl: string;
  logger: {
    info(obj: Record<string, unknown>, msg: string): void;
    warn(obj: Record<string, unknown>, msg: string): void;
  };
  clock?: (() => number) | undefined;
}

const resetBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: z.enum(DRIVER_LOCALES).optional(),
});

function tooMany(retryAfterS: number): CsmsError {
  return new CsmsError('Espere antes de pedir otro correo', 429, 'EMAIL_TOO_SOON', { retryAfterS });
}

function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || request.ip;
}

export function createAuthEmailRoutes(options: AuthEmailOptions) {
  const { sql, email, links, appWebUrl, logger } = options;
  const clock = options.clock ?? (() => Date.now());
  const perEmail = new RateLimiter(
    [
      { limit: 1, windowMs: 60_000 },
      { limit: 5, windowMs: 3_600_000 },
    ],
    clock,
  );
  const perIp = new RateLimiter([{ limit: 20, windowMs: 3_600_000 }], clock);
  const appHost = new URL(appWebUrl).host;

  const deliver = async (
    kind: 'VERIFY_EMAIL' | 'PASSWORD_RESET',
    to: string,
  ): Promise<'sent' | 'no-account'> => {
    let link: string;
    try {
      link = await links.generate(kind, to, { continueUrl: appWebUrl });
    } catch (error) {
      if (error instanceof IdentityLinkError && error.code === 'EMAIL_NOT_FOUND')
        return 'no-account';
      logger.warn({ err: error, kind }, 'no se pudo generar el enlace de identidad');
      throw new CsmsError(
        'No se pudo preparar el correo; intente más tarde',
        503,
        'EMAIL_UNAVAILABLE',
      );
    }
    const template = EMAIL_TEMPLATES[kind === 'VERIFY_EMAIL' ? 'verify-email' : 'reset-password'];
    const message = renderEmail(template, { link, email: to, appHost });
    try {
      const receipt = await email.send({ ...message, to });
      logger.info(
        { kind, provider: email.provider, id: receipt.id },
        'correo de identidad enviado',
      );
    } catch (error) {
      logger.warn(
        { err: error, kind, provider: email.provider },
        'el proveedor de correo rechazó el envío',
      );
      throw new CsmsError(
        'No se pudo enviar el correo; intente más tarde',
        503,
        'EMAIL_UNAVAILABLE',
      );
    }
    return 'sent';
  };

  return {
    /** Ruta pública: nunca revela si la cuenta existe. */
    async publicRoutes(app: FastifyInstance): Promise<void> {
      app.post('/auth/password-reset', async (request, reply) => {
        const body = resetBody.parse(request.body ?? {});
        const ipWait = perIp.hit(`ip:${clientIp(request)}`);
        if (ipWait > 0) throw tooMany(ipWait);
        const wait = perEmail.hit(`reset:${body.email}`);
        if (wait > 0) throw tooMany(wait);
        await deliver('PASSWORD_RESET', body.email);
        reply.code(202);
        return { sent: true };
      });
    },
    /** Ruta privada: reenvía la verificación al correo de la cuenta. */
    async privateRoutes(app: FastifyInstance): Promise<void> {
      app.post('/auth/send-verification', async (request, reply) => {
        const driver = driverOf(request);
        const row = await getDriver(sql, driver.driverId);
        if (!row.email) throw new CsmsError('La cuenta no tiene correo', 400, 'NO_EMAIL');
        if (row.email_verified) return { sent: false, alreadyVerified: true };
        const wait = perEmail.hit(`verify:${driver.driverId}`);
        if (wait > 0) throw tooMany(wait);
        const outcome = await deliver('VERIFY_EMAIL', row.email);
        reply.code(202);
        return { sent: outcome === 'sent' };
      });
    },
  };
}
