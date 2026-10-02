import { describe, expect, it, vi } from 'vitest';
import { describeError, installGlobalErrorHandler, reportClientError } from './client-errors.ts';

const context = {
  route: '/evse/VOLT-1',
  platform: 'ios',
  appVersion: '0.1.0',
  updateId: 'c5d10fe4-0000',
  fatal: true,
};

describe('informe de errores de la app', () => {
  it('describe un Error con mensaje y pila acotados', () => {
    const error = new Error(`Property 'crypto' doesn't exist${'!'.repeat(600)}`);
    const report = describeError(error, context);
    expect(report.message).toHaveLength(500);
    expect(report.message.startsWith("Property 'crypto' doesn't exist")).toBe(true);
    expect(report.stack?.length ?? 0).toBeLessThanOrEqual(4000);
    expect(report).toMatchObject({ route: '/evse/VOLT-1', platform: 'ios', fatal: true });
  });

  it('describe valores que no son Error', () => {
    expect(describeError('texto', { ...context, route: null }).message).toBe('texto');
    expect(describeError(undefined, context).message).toBe('undefined');
    expect(describeError('', context).message).toBe('Error sin mensaje');
    expect(describeError({ a: 1 }, context).stack).toBeNull();
  });

  it('envía el informe a la API y no lanza si falla la red', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const ok = await reportClientError(
      'https://api-staging.supercargadores.co',
      describeError(new Error('x'), context),
      (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    );
    expect(ok).toBe(true);
    const first = calls[0] as { url: string; body: { message: string } };
    expect(first.url).toBe('https://api-staging.supercargadores.co/v1/diagnostics/client-errors');
    expect(first.body.message).toBe('x');
    const failed = await reportClientError(
      'https://x',
      describeError(new Error('x'), context),
      (async () => {
        throw new Error('sin red');
      }) as typeof fetch,
    );
    expect(failed).toBe(false);
  });

  it('engancha ErrorUtils y conserva el manejador anterior', async () => {
    const previous = vi.fn();
    let installed: ((error: unknown, isFatal?: boolean) => void) | null = null;
    vi.stubGlobal('ErrorUtils', {
      getGlobalHandler: () => previous,
      setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => {
        installed = handler;
      },
    });
    const report = vi.fn(async () => true);
    installGlobalErrorHandler(report);
    expect(installed).not.toBeNull();
    const boom = new Error('boom');
    (installed as unknown as (error: unknown, isFatal?: boolean) => void)(boom, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(report).toHaveBeenCalledWith(boom, true);
    expect(previous).toHaveBeenCalledWith(boom, true);
    vi.unstubAllGlobals();
    // Sin ErrorUtils (web) no hace nada.
    installGlobalErrorHandler(report);
  });
});
