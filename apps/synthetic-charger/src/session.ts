/**
 * Sesión de prueba de extremo a extremo por la API de administración: el CSMS envía
 * RemoteStartTransaction al cargador sintético, este carga unos segundos y el CSMS la detiene.
 */
export interface TestSessionOptions {
  apiUrl: string;
  adminToken: string;
  evseId: string;
  durationMs: number;
  fetchImpl?: typeof fetch;
}

export interface TestSessionResult {
  ok: boolean;
  sessionId?: string;
  state?: string;
  error?: string;
  durationMs: number;
}

const TERMINAL = new Set(['ENDED', 'SETTLED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED']);

export async function runTestSession(options: TestSessionOptions): Promise<TestSessionResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const started = Date.now();
  const headers = {
    authorization: `Bearer ${options.adminToken}`,
    'content-type': 'application/json',
  };
  const base = options.apiUrl.replace(/\/$/, '');
  try {
    const start = await fetchImpl(`${base}/admin/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ evseId: options.evseId, channel: 'TEST' }),
    });
    const created = (await start.json()) as { id?: string; state?: string; message?: string };
    if (!start.ok || !created.id) {
      return {
        ok: false,
        error: `inicio ${start.status}: ${created.message ?? JSON.stringify(created).slice(0, 200)}`,
        durationMs: Date.now() - started,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, options.durationMs));
    // Fastify rechaza (400) un POST con content-type JSON y sin cuerpo: se envía un objeto vacío.
    const stop = await fetchImpl(`${base}/admin/v1/sessions/${created.id}/stop`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    if (!stop.ok && stop.status !== 409) {
      const detail = await stop.text().catch(() => '');
      return {
        ok: false,
        sessionId: created.id,
        error: `parada ${stop.status}: ${detail.slice(0, 200)}`,
        durationMs: Date.now() - started,
      };
    }
    let state = 'UNKNOWN';
    for (let attempt = 0; attempt < 30; attempt++) {
      const view = await fetchImpl(`${base}/admin/v1/sessions/${created.id}`, { headers });
      const body = (await view.json()) as { state?: string };
      state = body.state ?? state;
      if (TERMINAL.has(state)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const ok = state === 'ENDED' || state === 'SETTLED' || state === 'PAID';
    return {
      ok,
      sessionId: created.id,
      state,
      ...(ok ? {} : { error: `estado final ${state}` }),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message, durationMs: Date.now() - started };
  }
}
