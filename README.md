# Volt Platform

CSMS propio (Charging Station Management System) para operar una red de estaciones de carga de vehículos eléctricos: los cargadores se conectan por OCPP 1.6J directamente a la plataforma, desplegada en Google Cloud, con back-office para el operador, motor de tarifas con precios dinámicos, motor de parámetros configurables por nivel, seguridad de nivel productivo y una app de conductor separada que consume la API pública.

## Estado

Diseño terminado y decisiones tomadas (septiembre de 2026): Colombia, Wompi con tokenización y cobro al final de la carga, parque inicial de 3 estaciones DC de 180 kW con dos mangueras (30 en el primer año), OCPP 1.6J con perfil de seguridad 2, región us-east1, app "Volt" en español e inglés, desarrollo por iteraciones con Claude Code. Las decisiones están en `docs/adr/`. Iteraciones 0 a 4 terminadas: gateway OCPP 1.6J con registro y persistencia en PostgreSQL, inventario y comisionamiento desde la API de administración, comandos remotos, detección de deriva, sesiones de carga completas (inicio desde la app, progreso en vivo por SSE, parada, transacciones offline y reconexión) y motor de tarifas (modelo OCPI con franjas horarias, snapshot por sesión, costo en vivo, ocupación con gracia, tope de exposición que detiene la carga, liquidación con líneas de costo) probados con un cargador simulado (ver `docs/plan-de-trabajo.md` §5).

## Documentación

| Archivo | Contenido |
|---|---|
| [`docs/plan-de-trabajo.md`](docs/plan-de-trabajo.md) | Plan vivo del proyecto: decisiones pendientes, próximas acciones, fases con entregables y criterios de aceptación, plan de traspaso de los cargadores, equipo, riesgos y métricas |
| [`docs/00-resumen-ejecutivo.md`](docs/00-resumen-ejecutivo.md) | Resumen ejecutivo y guía de decisión: respuestas directas, arquitectura en una página, doce puntos clave, seguridad, tarifas, hechos verificados, requisitos al proveedor, decisiones y roadmap |
| [`docs/README.md`](docs/README.md) | Índice de los siete capítulos técnicos y orden de lectura recomendado |
| [`docs/sql/ddl_local.sql`](docs/sql/ddl_local.sql) | DDL del modelo de datos validado en PostgreSQL 16 |

## Arquitectura en una frase

Gateway OCPP como proceso separado en GKE Autopilot; API, worker y back-office en Cloud Run; PostgreSQL en Cloud SQL, Redis en Memorystore, Pub/Sub y BigQuery; un balanceador con Cloud Armor como única entrada; stack TypeScript de punta a punta; app móvil en React Native como cliente de la API `/v1`.

## Desarrollo

Requisitos: Node 22, pnpm 10 (`corepack enable`), Docker con Compose para PostgreSQL y Redis locales.

```bash
pnpm install
cp .env.example .env
pnpm services:up          # PostgreSQL 16 y Redis 7
pnpm db:migrate           # aplica las migraciones
pnpm lint && pnpm typecheck && pnpm test
pnpm dev:gateway          # gateway OCPP en ws://localhost:9220/ocpp/{chargeBoxId}
pnpm dev:api              # API en http://localhost:8080
```

Con `DATABASE_URL` el gateway autentica contra el inventario (`assets.charge_point` y sus credenciales); sin ella usa el registro estático `OCPP_STATIC_REGISTRY` (laboratorio). Para comisionar un cargador simulado de punta a punta con la API de administración sigue `lab/README.md`. Las convenciones de trabajo están en `CLAUDE.md`.

| Directorio | Contenido |
|---|---|
| `apps/ocpp-gateway` | Servidor OCPP-J 1.6 (WebSocket persistente, allowlist, validación de esquemas, persistencia, API interna de comandos, directorio en Redis) |
| `apps/api` | API Fastify: `/v1` para la app (sedes, EVSE con tarifa, sesiones con costo, SSE), `/admin/v1` para el back-office (inventario, comisionamiento, comandos, sesiones, alarmas, tarifas y versiones, asignaciones, parámetros, simulador de precios, costo y liquidación) |
| `apps/worker` | Trabajos en segundo plano: relay del outbox, expiración de arranques, cierre de transacciones huérfanas, particiones mensuales, revisión diaria de deriva, liquidación de sesiones, límites de sesión (tope de exposición, duración máxima) y activación de tarifas programadas |
| `apps/backoffice`, `apps/mobile` | Back-office web y app Volt (iteraciones 6 y 7) |
| `packages/domain` | Máquinas de estado y dinero en enteros |
| `packages/ocpp-schemas` | Esquemas JSON oficiales de OCPP 1.6 y validadores |
| `packages/events` | Catálogo y sobre de eventos de dominio |
| `packages/db` | Migraciones SQL y cliente PostgreSQL |
| `packages/tariff-engine` | Motor de tarifas puro y determinista (modelo OCPI 2.2.1 con extensiones `x_volt`, franjas horarias, ocupación con gracia, ajustes, topes, alertas de exposición, hashes) |
| `packages/csms` | Núcleo sobre la base de datos: inventario, ciclo de vida, credenciales, comandos, comisionamiento, alarmas, sesiones y precios (tarifas versionadas, asignaciones, snapshot, liquidación) |
| `packages/security` | `AuthorizationKey` aleatoria y hash scrypt (ADR 0014) |
| `packages/gateway-client` | Directorio cargador → pod (Redis) y cliente de la API interna del gateway (ADR 0013) |
| `packages/ocpp-sim` | Cargador OCPP 1.6J simulado para pruebas y laboratorio |
| `infra/terraform`, `lab/` | Infraestructura de Google Cloud y laboratorio de simuladores |

## Próximos pasos

Ver la sección 4 del plan de trabajo (tareas del dueño del proyecto en `docs/tareas-del-dueno.md`) y la sección 5 (iteraciones de desarrollo).
