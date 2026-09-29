import { createServer, type Server } from 'node:http';

export interface SyntheticStatus {
  connected: boolean;
  chargeBoxId: string;
  cycles: { ok: number; error: number };
  lastCycleAt: string | null;
}

/** `/healthz` para Cloud Run: el proceso vive aunque el gateway esté caído (eso lo dice el ciclo). */
export function startHealthServer(port: number, status: () => SyntheticStatus): Server {
  const server = createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'synthetic-charger', ...status() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, '0.0.0.0');
  return server;
}
