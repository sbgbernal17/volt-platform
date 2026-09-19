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

## Próximos pasos

Ver la sección 4 del plan de trabajo: requisitos al proveedor sobre el hardware, piloto con un cargador real, decisiones de país y pasarela de pago, conformación del equipo, proyectos de Google Cloud y monorepo.
