import { createHash, timingSafeEqual } from 'node:crypto';
import { LIFECYCLE_STATES, type LifecycleState } from '@volt/domain';
import { z } from 'zod';

/** Datos mínimos que el gateway necesita de un cargador dado de alta. */
export interface RegisteredChargePoint {
  readonly identity: string;
  readonly tenantId: string;
  readonly lifecycle: LifecycleState;
}

/**
 * Puerto de consulta del registro de cargadores. La implementación de producción lee de la
 * base de datos (iteración 2); la estática sirve para laboratorio y pruebas.
 */
export interface ChargePointRegistry {
  /**
   * Devuelve el cargador si la identidad existe y la credencial coincide; `undefined` en
   * cualquier otro caso (no distingue entre identidad desconocida y credencial errónea).
   */
  authenticate(
    identity: string,
    password: Buffer | undefined,
  ): Promise<RegisteredChargePoint | undefined>;
}

const entrySchema = z.object({
  identity: z.string().min(1).max(64),
  password: z.string().min(1),
  lifecycle: z.enum(LIFECYCLE_STATES).default('OPERATIONAL'),
  tenantId: z.string().min(1).default('volt'),
});

export type StaticRegistryEntry = z.input<typeof entrySchema>;

function digest(value: Buffer | string): Buffer {
  return createHash('sha256').update(value).digest();
}

export class StaticRegistry implements ChargePointRegistry {
  private readonly entries = new Map<
    string,
    { passwordDigest: Buffer; chargePoint: RegisteredChargePoint }
  >();

  constructor(entries: readonly StaticRegistryEntry[]) {
    for (const raw of entries) {
      const entry = entrySchema.parse(raw);
      this.entries.set(entry.identity, {
        passwordDigest: digest(entry.password),
        chargePoint: {
          identity: entry.identity,
          tenantId: entry.tenantId,
          lifecycle: entry.lifecycle,
        },
      });
    }
  }

  get size(): number {
    return this.entries.size;
  }

  async authenticate(
    identity: string,
    password: Buffer | undefined,
  ): Promise<RegisteredChargePoint | undefined> {
    const entry = this.entries.get(identity);
    // Comparación en tiempo constante aunque la identidad no exista.
    const expected = entry?.passwordDigest ?? digest('');
    const provided = digest(password ?? Buffer.alloc(0));
    const matches = timingSafeEqual(expected, provided);
    if (!entry || !password || !matches) return undefined;
    return entry.chargePoint;
  }
}

/** Construye el registro estático a partir de la variable OCPP_STATIC_REGISTRY (JSON). */
export function registryFromJson(json: string | undefined): StaticRegistry {
  if (!json) return new StaticRegistry([]);
  const parsed = z.array(entrySchema).safeParse(JSON.parse(json));
  if (!parsed.success) {
    throw new Error(
      `OCPP_STATIC_REGISTRY inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return new StaticRegistry(parsed.data);
}
