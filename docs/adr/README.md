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
| [0020](0020-cobro-con-wompi-reintentos-deuda-y-conciliacion.md) | Cobro con Wompi al liquidar: fuente de pago tokenizada, reintentos, deuda con enlace de pago, webhooks idempotentes, devoluciones, conciliación y recibos |
| [0021](0021-identidad-del-personal-rbac-auditoria-y-back-office.md) | Identidad del personal con Identity Platform, RBAC con política central por ruta, MFA TOTP, auditoría inmutable con cadena de hashes y back-office como SPA servida por nginx |
| [0022](0022-app-volt-identidad-del-conductor-y-notificaciones.md) | App Volt: identidad del conductor con Identity Platform, consentimientos, tokenización en la app y notificaciones push |
| [0023](0023-infraestructura-en-google-cloud-con-terraform.md) | Infraestructura en Google Cloud con Terraform: tres ambientes, dos balanceadores por ambiente (Gateway API para cargadores, Cloud Run para web), Cloud SQL privado con TLS, Redis, Pub/Sub a BigQuery, secretos, GKE Autopilot con despliegue sin cortes, observabilidad y cargador sintético |
| [0024](0024-diseno-ux-mapas-estacion-de-pruebas-tarifas-y-correos.md) | Diseño y experiencia de uso: mapas de Google, estación de pruebas, editor de tarifas y correos con marca |
| [0025](0025-sistema-de-diseno-de-la-app-a-partir-del-handoff.md) | Sistema de diseño de la app Volt a partir del handoff de UI/UX del dueño: tokens, componentes, barra de pestañas con botón Cargar y flujo de carga; lo adaptado o aplazado por límites del backend |
| [0026](0026-potencia-del-gabinete-compartida-entre-conectores.md) | Potencia máxima por gabinete (`charge_point.max_power_w`) compartida entre sus conectores: regla derivada, "hasta 180 kW" en la app y el back-office, edición auditada; el nivelado lo hace el gabinete y el `ChargePointMaxProfile` queda en la fase 2 |
| [0027](0027-documento-de-identidad-y-factura-electronica-en-el-perfil.md) | Documento de identidad opcional en el perfil (CC, CE, NIT con dígito de verificación, PAS, PPT), obligatorio cuando el conductor pide factura electrónica; regla en el CSMS sobre el estado resultante, snapshot del adquiriente en el recibo, enmascarado en listas y redacción en auditoría |
| [0028](0028-recibo-en-pdf-generado-en-la-api.md) | Recibo de carga en PDF generado en la API con pdf-lib (JavaScript puro, sin archivos en tiempo de ejecución), descargable desde la app web, compartible en iOS y Android con expo-file-system y expo-sharing, y abierto desde el back-office |
| [0029](0029-resumen-de-ingresos-estado-del-proveedor-y-dia-contable.md) | Resumen de ingresos por período y medio de pago, estado del proveedor (salud de la pasarela más señales de la base) y día contable en hora de Colombia para conciliación y filtros |
| [0030](0030-el-back-office-adopta-el-sistema-de-diseno-de-la-app.md) | El back-office adopta el sistema de diseño de la app: tokens compartidos, selector de tema (sistema, claro, oscuro), Material Icons, estados por palabra, ícono y color desde un solo módulo, botones, insignias, avisos, KPI y barra lateral como en la app |
| [0031](0031-celular-verificado-por-sms.md) | Celular verificado por SMS con código de un solo uso gestionado por la plataforma (puerto `SmsSender`, emulador, Twilio y Brevo), obligatorio para pagar y cargar después del correo y los consentimientos; un celular verificado por cuenta |
| [0032](0032-correos-de-identidad-con-envio-propio.md) | Correos de verificación y contraseña con envío propio: la API genera el enlace de Identity Platform con su cuenta de servicio y lo envía en la plantilla con la marca (botón) por Resend o Brevo; sin proveedor sigue el correo genérico de Google |
| [0033](0033-cobro-minimo-por-conexion.md) | Cobro mínimo por conexión de 2.000 COP como `min_price` de la tarifa base: línea `CAP` "Cobro mínimo por conexión" en el costo en curso, el recibo, el PDF, la app y el back-office; la versión publicada se actualiza sola |
| [0034](0034-nombre-y-apellidos-separados-y-datos-del-comprador.md) | Nombre y apellidos separados en el conductor (`first_name`, `last_name`; `display_name` derivado) y datos del comprador para la DIAN según el contador: nombre y apellidos o razón social, cédula o NIT con o sin dígito de verificación, y correo |
| [0035](0035-ip-fija-de-salida-para-cloud-run.md) | IP fija de salida para Cloud Run con Cloud NAT y dirección reservada, opcional por ambiente (`static_egress_ip`): Wompi y Brevo bloquean o restringen las direcciones cambiantes de Google; activada en staging (`34.42.100.85`), prod la hereda, dev sigue sin ella |
| [0036](0036-clave-de-identity-platform-para-la-app-nativa.md) | La clave pública de Identity Platform que reciben la app y el back-office se restringe solo por API (Identity Toolkit y Secure Token), sin referer HTTP: la app nativa de iOS y Android no envía referer y Google la bloqueaba; App Check queda como endurecimiento para producción |

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
