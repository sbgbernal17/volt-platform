# ADR 0038. Contención de costos en los ambientes de prueba

- Estado: aceptado (02-10-2026, "los costos de GCP están muy altos, optimicémoslo"); cambios en `main`, planes de Terraform revisados, **aplicación pendiente** (ver "Consecuencias")
- Decisores: dueño del proyecto, Claude Code
- Relacionados: ADR 0023 (infraestructura en Google Cloud), ADR 0035 (IP fija de salida), inventario de costos del 01-10-2026 en `docs/tareas-del-dueno.md`

## Contexto

Dev y staging cuestan unos 700 USD al mes a precio de lista (≈ 620 reales con el crédito de GKE)
sin que haya cargadores físicos ni usuarios. El inventario del 01-10 mostró que casi todo es
capacidad **siempre encendida** aunque nadie use los ambientes: un clúster de GKE Autopilot por
ambiente (73 USD cada uno; el crédito de la cuenta cubre uno), el worker y el cargador sintético en
Cloud Run con CPU siempre asignada (49 USD cada uno por ambiente; Cloud Run no admite menos de
1 vCPU en ese modo), Redis (36), Cloud SQL (28 en dev, 55 en staging), balanceadores e IP (36) y, en
staging, Cloud NAT con IP fija (35) y Cloud Armor (21).

## Decisión

Se preparan los recortes de **capacidad** que no cambian la arquitectura ni la protección de
los ambientes y se pueden deshacer con un `apply`:

| Ambiente | Cambio | Ahorro de lista (USD/mes) |
|---|---|---|
| staging | Cloud SQL `db-custom-1-3840` → `db-g1-small` (núcleo compartido, como dev; reinicio de 1 a 2 minutos al aplicar) | ≈ 27 |
| staging | Gateway OCPP: de 2 pods de 500m/1Gi a 1 pod de 250m/512Mi (máximo 3). Sin alta disponibilidad hasta la prueba de carga de la iteración 10: un despliegue reconecta los cargadores en unos 20 s | ≈ 30 |
| dev | Cargador sintético apagado (`synthetic_enabled = false`): las cargas de prueba se hacen en staging, que es a donde apuntan las apps de las tiendas | ≈ 49 |

Quedan como decisiones del dueño, con su ahorro, en `docs/tareas-del-dueno.md`:

- **Destruir dev** (≈ 240 USD de lista tras los recortes; hace que el crédito de GKE cubra el
  clúster de staging): se recrea en 20 minutos, pero las IP públicas cambian y hay que volver a
  crear 4 registros DNS. El despliegue automático de cada push a `main` pasaría a staging.
- **Cloud Armor apagado en staging hasta prod** (≈ 21 USD): sin límite de peticiones ni reglas WAF
  en el borde de un ambiente público; la API conserva sus propios límites (códigos SMS, correos).
- **Worker y cargador sintético como pods del clúster** en lugar de Cloud Run con CPU siempre
  asignada (≈ 78 USD por ambiente): cambia dónde corren dos servicios (ADR 0023), exige extender el
  Cloud NAT a la subred del clúster en staging y nuevos manifiestos; conviene hacerlo junto con el
  dimensionamiento de prod.
- **Redis como pod del clúster en los ambientes de prueba** (≈ 26 USD por ambiente): sin
  persistencia administrada; el registro de cargadores se reconstruye solo con los latidos.

Prod no se toca: se dimensiona aparte con la prueba de carga (ADR 0023).

## Alternativas consideradas

- **Instancias mínimas en cero para el worker**: Cloud Run lo apagaría sin tráfico y los trabajos
  en segundo plano (liquidación, cobros, avisos) dejarían de correr; el ambiente quedaría a medias.
- **Worker disparado por Cloud Scheduler** (un "tick" por minuto con CPU solo durante la petición,
  ≈ 10 USD): reduce la latencia de los avisos a un minuto; válido para ambientes de prueba, no para
  prod. Se evalúa con la opción de pods del clúster.
- **Cloud SQL `db-f1-micro`** (≈ 11 USD): 0,6 GB de RAM y sin SLA; con tres servicios conectados
  queda justo. `db-g1-small` ya está probado en dev.

## Consecuencias

- Los cambios están en `main` (commit `5394f1c`) y los planes de Terraform del 02-10-2026 (18:51 UTC)
  muestran exactamente lo esperado: staging, 2 cambios (la base pasa a `db-g1-small`; un ajuste
  cosmético del tablero) y 0 bajas; dev, 1 cambio (tablero) y 2 bajas (el servicio del cargador
  sintético y el SLO que dependía de él). **Se aplican** con Actions → *Infraestructura (Terraform)*
  → `dev` → `apply` y `staging` → `apply` (la sesión de Claude Code no pudo ejecutar el apply por sí
  sola; el dueño lo lanza o lo autoriza explícitamente), y después *Despliegue* → `staging` con
  `image_tag` `dc6883f91667` para que el gateway tome el tamaño nuevo. La base de staging se
  reinicia 1 a 2 minutos durante el apply.
- Staging pasa de ≈ 405 a ≈ 348 USD de lista y dev de ≈ 291 a ≈ 242; en total ≈ 106 USD menos al
  mes. El flujo *Costos de Google Cloud (inventario)* recalcula la estimación tras cada cambio.
- Sin el segundo pod del gateway en staging, un despliegue del gateway corta la conexión del
  cargador sintético unos 20 s (se reconecta solo); la alarma de cargador fuera de línea no salta
  porque su umbral es mayor.
- Qué revisar después: la cifra real en Facturación → Informes (dime qué SKU aparece alto), y las
  cuatro decisiones pendientes, en ese orden de ahorro.
