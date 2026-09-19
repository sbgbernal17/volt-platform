# 0010. PostgreSQL en Cloud SQL con migraciones SQL versionadas

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

El modelo de datos (capítulo DAT) es relacional, transaccional y con volúmenes moderados (decenas de conectores en el primer año); las mediciones se archivan en BigQuery.

## Decisión

Cloud SQL para PostgreSQL 16 en alta disponibilidad con IP privada y PITR. El esquema se gobierna con migraciones SQL puras en `packages/db/migrations`, aplicadas con node-pg-migrate; la migración inicial es el DDL validado del capítulo DAT (29 tablas, vista de estado derivado, funciones de configuración por niveles). Nunca se edita una migración aplicada: se añade una nueva. Cada migración se prueba en CI contra una base vacía (creación, idempotencia). Los importes y contadores se leen como `bigint` nativo (postgres.js con `types.bigint`), nunca como `Number`.

## Alternativas consideradas

- AlloyDB: más caro y sin ventajas necesarias a esta escala; la migración posterior es posible por compatibilidad.
- ORM con migraciones generadas: el DDL ya existe y está validado; SQL explícito es más transparente para auditar particiones, índices y funciones.

## Consecuencias

- `pg_partman` y `pg_cron` para el particionado de mediciones se activan en Cloud SQL con una migración específica de entorno (no están en la migración base para que el desarrollo local funcione sin extensiones).
- La API de datos de la aplicación se construye con consultas tipadas sobre postgres.js; si el volumen de código lo justifica, se evaluará Drizzle solo para consultas, manteniendo las migraciones en SQL.
