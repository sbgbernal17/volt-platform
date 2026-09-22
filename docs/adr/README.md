# Registros de decisiones de arquitectura (ADR)

Cada decisión relevante se registra en un archivo `NNNN-titulo.md` con la plantilla del final. Los ADR 0001 a 0006 recogen las decisiones de negocio y de contexto tomadas por el dueño del proyecto; los ADR técnicos previstos en ARQ §8.1 se numeran desde 0007 (gateway OCPP en GKE Autopilot, monolito modular con gateway separado, stack TypeScript, PostgreSQL en Cloud SQL, modelo de tarifas alineado a OCPI).

| ADR | Decisión |
|---|---|
| [0001](0001-pais-de-operacion-colombia.md) | País de operación: Colombia |
| [0002](0002-pasarela-wompi-y-modelo-de-cobro.md) | Pasarela Wompi y modelo de cobro con tarjeta tokenizada al final de la carga |
| [0003](0003-parque-inicial-hardware-y-version-ocpp.md) | Parque inicial DC de 180 kW y 40 kW, OCPP 1.6J, perfil de seguridad 2 y luego 3 |
| [0004](0004-operador-unico-y-propietarios-de-sede.md) | Operador único con propietarios de sede de solo lectura en el futuro |
| [0005](0005-region-idiomas-marca-y-retencion.md) | Región us-east1 (reemplazada por 0015), app Volt en español e inglés, retención de datos |
| [0006](0006-equipo-y-metodo-de-desarrollo.md) | Desarrollo por iteraciones con Claude Code; responsabilidades del dueño del proyecto |
| [0007](0007-gateway-ocpp-en-gke-y-resto-en-cloud-run.md) | Gateway OCPP en GKE Autopilot; API, worker y back-office en Cloud Run |
| [0008](0008-monolito-modular-con-gateway-separado.md) | Monolito modular hexagonal con el gateway como proceso separado y eventos por outbox |
| [0009](0009-stack-typescript.md) | Stack TypeScript: Node 22, pnpm, Biome, Vitest, ocpp-rpc, Fastify, postgres.js, esbuild |
| [0010](0010-postgresql-y-migraciones-sql.md) | PostgreSQL en Cloud SQL con migraciones SQL versionadas |
| [0011](0011-modelo-de-tarifas-ocpi.md) | Modelo de tarifas OCPI 2.2.1 con snapshot inmutable por sesión |
| [0012](0012-tarifa-inicial-e-idle-fee.md) | Tarifa inicial de Volt: energía por franjas, gracia de 15 minutos configurable y 1.500 COP por minuto de ocupación |
| [0013](0013-api-interna-del-gateway-y-directorio-en-redis.md) | API interna HTTP del gateway con token, directorio de conexiones en Redis y `uniqueId` generado por el gateway |
| [0014](0014-hash-de-authorizationkey-con-scrypt.md) | Hash de la `AuthorizationKey` con scrypt de `node:crypto` |
| [0015](0015-region-us-central1.md) | Región principal `us-central1` tras medir la latencia desde Bogotá |
| [0016](0016-transacciones-en-el-gateway-sse-sobre-outbox.md) | Transacciones resueltas por el gateway con el núcleo compartido, SSE sobre el outbox y Pub/Sub diferido a la iteración 8 |
| [0017](0017-precios-al-consumidor-snapshot-y-tope-de-exposicion.md) | Precios al consumidor con IVA incluido, semántica OCPI del motor (ocupación por hora), snapshot fail-closed, ocupación y tope de exposición |
| [0018](0018-precios-iniciales-servicio-excluido-de-iva-y-ocupacion-sin-tope.md) | Precios iniciales de Volt (1.350 y 1.200 COP/kWh), servicio excluido de IVA, ocupación sin tope de tiempo y carga máxima de 4 horas |
| [0019](0019-dominio-supercargadores-co-y-nombres-de-host.md) | Dominio `supercargadores.co` (zona en Netlify DNS) y nombres de host `ocpp.`, `api.`, `admin.` y `app.` |

```markdown
# NNNN. Título de la decisión

Fecha: AAAA-MM-DD. Estado: propuesta | aceptada | reemplazada por NNNN.

## Contexto
Qué problema se resuelve y qué restricciones aplican.

## Decisión
Qué se decidió, en una o dos frases.

## Alternativas consideradas
Opción, ventajas, desventajas.

## Consecuencias
Qué cambia, qué riesgos se asumen, qué se debe revisar después.
```
| [0020](0020-cobro-con-wompi-reintentos-deuda-y-conciliacion.md) | Cobro con Wompi al liquidar: fuente de pago tokenizada, reintentos, deuda con enlace de pago, webhooks idempotentes, devoluciones, conciliación y recibos |
