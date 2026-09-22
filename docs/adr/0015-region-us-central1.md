# 0015. Región principal de Google Cloud: `us-central1`

Fecha: 2026-09-22. Estado: aceptada. Reemplaza el punto 1 del ADR 0005.

## Contexto

El ADR 0005 fijó `us-east1` como región principal a falta de una medición de latencia desde Bogotá. El 22 de septiembre de 2026 el dueño del proyecto ejecutó la prueba de `docs/google-cloud-setup.md` §7 (tiempo de conexión TCP a `<región>-run.googleapis.com`) desde su red: `us-central1` fue la más rápida (684 ms), por delante de `us-east1`, `northamerica-south1`, `southamerica-west1` y `southamerica-east1`. El valor absoluto es alto para un enlace Colombia → Estados Unidos (lo habitual es de 60 a 120 ms) y depende de la red desde la que se midió; lo que decide es el orden relativo.

## Decisión

`us-central1` (Iowa) es la región principal de los tres proyectos (dev, staging y prod): GKE Autopilot, Cloud Run, Cloud SQL, Memorystore, Pub/Sub y almacenamiento. Las copias de seguridad de Cloud SQL se replican además a `us-east1` como región secundaria. La estimación de costos de ARQ §7 ya estaba calculada en `us-central1`, la región de menor precio en Estados Unidos, y todos los servicios requeridos están disponibles en ella.

## Alternativas consideradas

- **`us-east1` (Carolina del Sur).** Latencia teórica similar; resultó más lenta en la medición y es algo más cara.
- **`northamerica-south1` (Querétaro) y `southamerica-west1` (Santiago).** Más cercanas geográficamente pero más lentas en la medición, con catálogo de servicios más reciente y precios regionales entre un 20 y un 40 % mayores.

## Consecuencias

- Terraform (iteración 8) usa `us-central1` por defecto; la guía de configuración y el plan quedan actualizados.
- Antes de la iteración 8 conviene repetir la medición desde la red por la que se conectarán los cargadores (SIM del operador móvil o enlace de la sede) y desde un teléfono con la app; si el orden cambia, se revisa este ADR. Para OCPP la latencia es irrelevante (plazos de segundos); importa para la app y el back-office.
- El tratamiento legal de la transferencia internacional de datos personales (Ley 1581) no cambia: el destino sigue siendo Estados Unidos.
