import { createServer, type Server } from 'node:http';

export interface HealthInfo {
  service: string;
  jobs: readonly string[];
  startedAt: Date;
}

/**
 * Endpoint mínimo de salud (`/healthz`) para Cloud Run, que exige que el contenedor escuche en un
 * puerto aunque el worker no atienda peticiones de negocio.
 */
export function startHealthServer(port: number, info: HealthInfo): Server {
  const server = createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/') {
      const body = JSON.stringify({
        status: 'ok',
        service: info.service,
        jobs: info.jobs,
        uptimeSeconds: Math.floor((Date.now() - info.startedAt.getTime()) / 1000),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, '0.0.0.0');
  return server;
}
