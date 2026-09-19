# 0009. Stack TypeScript de punta a punta

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

Un solo lenguaje reduce fricción entre gateway, API, worker, back-office y app, y permite compartir tipos y validaciones. Se necesita una biblioteca OCPP-J madura con esquemas oficiales y perfiles de seguridad.

## Decisión

- Node 22 LTS, pnpm 10 con workspaces y catálogo de versiones, TypeScript 5.9 estricto (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), ESM.
- Biome para lint y formato; Vitest para pruebas; `tsx` en desarrollo; esbuild para empaquetar cada app en un único archivo para la imagen de producción.
- `ocpp-rpc` para el servidor y los clientes OCPP-J (1.6J, 2.0.1J y 2.1J, perfiles de seguridad 1 a 3). La validación de mensajes se hace con los esquemas JSON oficiales embebidos en `@volt/ocpp-schemas` (Ajv), no con el modo estricto de la biblioteca, para controlar los códigos de error y el registro.
- Fastify para la API, zod para configuración y contratos, pino para logs JSON, postgres.js como cliente de base de datos, node-pg-migrate para migraciones SQL, ioredis para Redis.
- React con Vite para el back-office; React Native con Expo para la app Volt (ADR 0006).

## Alternativas consideradas

- CitrineOS (LF Energy, TypeScript, OCPP 1.6 y 2.0.1) como base: referencia arquitectónica y opción de adopción si el tiempo mandara; se descarta como base porque el dominio (tarifas por snapshot, pagos con Wompi, modelo colombiano) exige control total y el gateway propio es pequeño.
- Python (mobilityhouse/ocpp) o Java (SteVe): buenas referencias de comportamiento; obligarían a dos lenguajes.

## Consecuencias

- Los paquetes internos exportan su código fuente TypeScript; no hay paso de build para consumirlos.
- Las bibliotecas CommonJS con `export default` (Ajv y sus plugins) se importan a través de `.default` en ESM; queda documentado en `@volt/ocpp-schemas`.
