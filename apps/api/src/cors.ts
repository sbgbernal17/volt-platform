import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const DEFAULT_HEADERS = 'authorization,content-type,x-actor,idempotency-key,last-event-id';

/**
 * CORS sin dependencias para el back-office y la app web (orígenes explícitos, sin comodines ni
 * credenciales de cookie: la identidad viaja en `Authorization`). Las respuestas de otros orígenes no
 * llevan cabeceras y el navegador las bloquea.
 */
export function registerCors(app: FastifyInstance, origins: readonly string[]): void {
  if (origins.length === 0) return;
  const allowed = new Set(origins);
  const apply = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const origin = request.headers.origin;
    if (!origin || !allowed.has(origin)) return false;
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'origin');
    return true;
  };
  app.addHook('onRequest', async (request, reply) => {
    apply(request, reply);
  });
  app.route({
    method: 'OPTIONS',
    url: '/*',
    handler: async (request, reply) => {
      if (!apply(request, reply)) return reply.code(404).send();
      const requested = request.headers['access-control-request-headers'];
      reply.header('access-control-allow-methods', ALLOWED_METHODS);
      reply.header(
        'access-control-allow-headers',
        typeof requested === 'string' && requested ? requested : DEFAULT_HEADERS,
      );
      reply.header('access-control-max-age', '600');
      return reply.code(204).send();
    },
  });
}
