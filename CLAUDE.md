# Volt Platform: guía para sesiones de desarrollo

CSMS propio (Charging Station Management System) para estaciones de carga de vehículos eléctricos en Colombia. Los cargadores hablan OCPP 1.6J por WebSocket directamente con `apps/ocpp-gateway`; el resto del sistema (API, worker, back-office, app Volt) consume el dominio y la base de datos.

## Antes de tocar código

- Lee `docs/plan-de-trabajo.md` (iteración en curso, criterios de aceptación) y el ADR que aplique en `docs/adr/`. Las decisiones de negocio están en los ADR 0001 a 0006; las técnicas desde 0007.
- El diseño detallado vive en `docs/00-resumen-ejecutivo.md` y los capítulos `docs/01` a `docs/07`. Cítalos como "ARQ §4.4", "DAT §3.2", etc.
- Toda decisión nueva se registra como ADR. Todo cambio de alcance se refleja en el plan de trabajo.

## Stack y estructura

- Node 22, pnpm 10 (workspaces con `catalog:` en `pnpm-workspace.yaml`), TypeScript 5.9 estricto, ESM, Biome (lint y formato), Vitest.
- Los paquetes internos exportan su código fuente TypeScript (`exports: ./src/index.ts`); las apps se ejecutan con `tsx`. No hay paso de build para consumir un paquete interno.
- `packages/domain`: estados de conector, sesión, comando y ciclo de vida del cargador; dinero en enteros (`bigint`), nunca float.
- `packages/ocpp-schemas`: esquemas JSON oficiales de OCPP 1.6 y validadores (`validateRequest`, `validateResponse`). No modificar los archivos de `schemas/`.
- `packages/events`: catálogo de eventos de dominio y sobre común; ULID como identificador.
- `packages/db`: migraciones SQL en `migrations/` (node-pg-migrate) y cliente postgres.js. La migración inicial es el DDL validado del capítulo DAT. Nunca se edita una migración aplicada: se añade otra.
- `packages/tariff-engine`: motor de tarifas (modelo OCPI 2.2.1, snapshot por sesión). Función pura y determinista.
- `apps/ocpp-gateway`: servidor OCPP-J con `ocpp-rpc`. Corre en GKE Autopilot en producción.
- `apps/api`: Fastify. `apps/worker`: trabajos en segundo plano. `apps/backoffice`: React. `apps/mobile`: React Native/Expo (app Volt).
- `infra/terraform`: infraestructura de Google Cloud. `lab/`: simuladores de cargador y suites de prueba OCPP.

## Comandos

```bash
pnpm install                 # dependencias
pnpm services:up             # PostgreSQL y Redis locales (docker compose)
pnpm lint && pnpm typecheck  # Biome y tsc en todos los paquetes
pnpm test                    # Vitest en todos los paquetes (usa DATABASE_URL y REDIS_URL si existen)
pnpm db:migrate              # aplica migraciones (DATABASE_URL)
pnpm dev:gateway | dev:api | dev:worker
```

Variables de entorno: copiar `.env.example` a `.env`. Sin `DATABASE_URL`, las pruebas de base de datos se omiten.

## Reglas de trabajo

- Español en documentación, comentarios y mensajes de commit; identificadores de código en inglés; nombres de mensajes y campos OCPP exactamente como en la especificación.
- Cada cambio lleva pruebas. Los mensajes OCPP entrantes se validan siempre contra los esquemas oficiales antes de tocar el dominio (SEG S3).
- El cargador no es de confianza (SEG S4): allowlist de identidades, `idTag` solo si lo emitió la plataforma, propiedad de la transacción por `(charge_point_id, transactionId)`.
- Nunca se escriben secretos en el repositorio ni en logs. Configuración por variables de entorno validadas con zod.
- Sin dependencias nuevas sin justificarlas en el PR; preferir la biblioteca estándar de Node.
- Antes de proponer un PR: `pnpm lint && pnpm typecheck && pnpm test` en verde, y una nota de "qué probar" para el dueño del proyecto.
- Los commits terminan con las líneas de atribución que indique la sesión; no se hace push a `main` sin que el dueño lo pida.
