import { createLogger } from '@volt/logging';
import { describe, expect, it } from 'vitest';
import { csmsLogger } from './pricing.ts';

describe('logger de los trabajos de precios', () => {
  const logger = createLogger({ service: 'worker-test', level: 'warn', pretty: false });

  it('los métodos de pino sueltos fallan (la causa de los trabajos session-limits fallidos)', () => {
    const detached = { warn: logger.warn };
    expect(() => detached.warn({ sessionId: 'x' }, 'prueba')).toThrow(/writeSym/);
  });

  it('el adaptador conserva `this` y no lanza en info, warn ni error', () => {
    const adapted = csmsLogger(logger);
    expect(() => {
      adapted.info({ sessionId: 'x' }, 'info');
      adapted.warn({ sessionId: 'x' }, 'sesión detenida por tope de exposición');
      adapted.error({ sessionId: 'x' }, 'error');
    }).not.toThrow();
  });

  it('sin warn en el planificador, warn cae en info sin perder el receptor', () => {
    const calls: string[] = [];
    const minimal = {
      info(_obj: Record<string, unknown>, msg?: string) {
        calls.push(`info:${msg ?? ''}:${this === minimal}`);
      },
      error(_obj: Record<string, unknown>, msg?: string) {
        calls.push(`error:${msg ?? ''}:${this === minimal}`);
      },
    };
    const adapted = csmsLogger(minimal);
    adapted.warn({}, 'aviso');
    adapted.error({}, 'fallo');
    expect(calls).toEqual(['info:aviso:true', 'error:fallo:true']);
  });
});
