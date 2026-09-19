# Volt Platform

CSMS propio (Charging Station Management System) para operar una red de estaciones de carga de vehículos eléctricos: los cargadores se conectan por OCPP 1.6J directamente a la plataforma, desplegada en Google Cloud, con back-office para el operador, motor de tarifas con precios dinámicos, motor de parámetros configurables por nivel, seguridad de nivel productivo y una app de conductor separada que consume la API pública.

## Estado

Fase de diseño terminada y decisiones tomadas (septiembre de 2026): Colombia, Wompi con tokenización y cobro al final de la carga, parque inicial de 3 estaciones DC de 180 kW con dos mangueras (30 en el primer año), OCPP 1.6J con perfil de seguridad 2, región us-east1, app "Volt" en español e inglés, desarrollo por iteraciones con Claude Code. Las decisiones están en `docs/adr/`. El código se inicia en la iteración 0 del plan de trabajo.

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

Para conectar un simulador al gateway local, define `OCPP_STATIC_REGISTRY` en `.env` (ver `.env.example`) y sigue `lab/README.md`. Las convenciones de trabajo están en `CLAUDE.md`.

| Directorio | Contenido |
|---|---|
| `apps/ocpp-gateway` | Servidor OCPP-J 1.6 (WebSocket persistente, allowlist, validación de esquemas, eventos) |
| `apps/api` | API Fastify: `/v1` para la app, `/admin` para el back-office |
| `apps/worker` | Trabajos en segundo plano (outbox, timeouts, conciliación) |
| `apps/backoffice`, `apps/mobile` | Back-office web y app Volt (iteraciones 6 y 7) |
| `packages/domain` | Máquinas de estado y dinero en enteros |
| `packages/ocpp-schemas` | Esquemas JSON oficiales de OCPP 1.6 y validadores |
| `packages/events` | Catálogo y sobre de eventos de dominio |
| `packages/db` | Migraciones SQL y cliente PostgreSQL |
| `packages/tariff-engine` | Motor de tarifas (modelo OCPI, snapshot por sesión) |
| `infra/terraform`, `lab/` | Infraestructura de Google Cloud y laboratorio de simuladores |

## Próximos pasos

Ver la sección 4 del plan de trabajo (tareas del dueño del proyecto en `docs/tareas-del-dueno.md`) y la sección 5 (iteraciones de desarrollo).
