import { readFileSync } from 'node:fs';
import { type Logger, type LoggerOptions, pino } from 'pino';

export type { Logger } from 'pino';

/** Niveles de pino → `severity` de Cloud Logging (OPS §2.7). */
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

export interface LoggerConfig {
  /** Nombre del servicio (`service` en cada línea). */
  service: string;
  level?: string | undefined;
  /** Salida legible con pino-pretty (solo desarrollo local; no está en las imágenes). */
  pretty?: boolean | undefined;
  /** Ambiente (dev, staging, prod) para filtrar en Logs Explorer. */
  env?: string | undefined;
}

/**
 * Opciones de pino para que Cloud Logging indexe cada línea: `severity` en vez del nivel numérico,
 * `message` como texto principal y `time` en ISO 8601. Sirven tanto para `pino()` como para el
 * `logger` de Fastify.
 */
export function pinoOptions(config: LoggerConfig): LoggerOptions {
  const level = config.level ?? 'info';
  if (config.pretty) {
    return { level, transport: { target: 'pino-pretty' } };
  }
  return {
    level,
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: config.service, ...(config.env ? { env: config.env } : {}) },
    formatters: {
      level(label) {
        return { severity: SEVERITY[label] ?? 'DEFAULT', level: label };
      },
    },
  };
}

export function createLogger(config: LoggerConfig): Logger {
  return pino(pinoOptions(config));
}

/**
 * Secretos montados como archivos (GKE con el complemento de Secret Manager): para cada variable
 * `X_FILE` presente y con `X` vacía, carga el contenido del archivo en `X`. Devuelve una copia.
 */
export function withFileSecrets(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...env };
  for (const [name, path] of Object.entries(env)) {
    if (!name.endsWith('_FILE') || !path) continue;
    const target = name.slice(0, -'_FILE'.length);
    if (resolved[target]) continue;
    resolved[target] = readFileSync(path, 'utf8').trim();
  }
  return resolved;
}
