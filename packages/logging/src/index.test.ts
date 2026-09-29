import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pinoOptions, withFileSecrets } from './index.ts';

describe('pinoOptions', () => {
  it('usa severity y message para Cloud Logging', () => {
    const options = pinoOptions({ service: 'api', level: 'debug', env: 'dev' });
    expect(options.messageKey).toBe('message');
    expect(options.base).toEqual({ service: 'api', env: 'dev' });
    const level = options.formatters?.level as (label: string, n: number) => Record<string, string>;
    expect(level('warn', 40)).toEqual({ severity: 'WARNING', level: 'warn' });
    expect(level('fatal', 60)).toEqual({ severity: 'CRITICAL', level: 'fatal' });
  });

  it('en modo legible delega en pino-pretty', () => {
    expect(pinoOptions({ service: 'api', pretty: true }).transport).toEqual({
      target: 'pino-pretty',
    });
  });
});

describe('withFileSecrets', () => {
  it('carga X desde X_FILE sin pisar un valor presente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'volt-secrets-'));
    writeFileSync(join(dir, 'db'), 'postgres://volt:s3cr3t@10.0.0.5:5432/volt\n');
    writeFileSync(join(dir, 'token'), 'abc');
    const env = withFileSecrets({
      DATABASE_URL_FILE: join(dir, 'db'),
      TOKEN_FILE: join(dir, 'token'),
      TOKEN: 'ya-definido',
      OTRA: 'x',
    });
    expect(env.DATABASE_URL).toBe('postgres://volt:s3cr3t@10.0.0.5:5432/volt');
    expect(env.TOKEN).toBe('ya-definido');
    expect(env.OTRA).toBe('x');
  });
});
