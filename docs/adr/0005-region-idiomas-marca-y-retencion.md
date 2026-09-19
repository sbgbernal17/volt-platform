# 0005. Región de Google Cloud, idiomas, marca y retención de datos

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

No existe región de Google Cloud en Colombia. La app se llamará Volt, el idioma principal es el español con versión en inglés, y el dueño del proyecto quiere conservar todos los datos.

## Decisión

1. **Región principal `us-east1`** para los tres proyectos (dev, staging, prod); se mide la latencia desde Bogotá antes de fijarla y se documenta la transferencia internacional de datos personales según la Ley 1581 de 2012 (nivel adecuado de protección o autorización expresa en la app, a confirmar con el asesor legal).
2. **Marca y app:** la app del conductor se llama Volt; el diseño visual lo aportará el dueño del proyecto más adelante. Español como idioma principal e inglés disponible desde el inicio: internacionalización en la app, en el back-office y en recibos y notificaciones, con textos en archivos de recursos y nunca en código.
3. **Retención:** se conservan todos los datos operativos y de telemetría: mediciones y eventos en BigQuery sin fecha de borrado, 90 días en caliente en PostgreSQL, sesiones y liquidaciones de forma permanente, auditoría permanente y mensajes OCPP crudos 30 días. Los datos personales de conductores se conservan mientras la cuenta esté activa y después según la política de tratamiento de datos (finalidad y plazo definidos con el asesor legal), con seudonimización de los datos personales en la analítica y atención de solicitudes de supresión de los titulares. "Guardar todos los datos" aplica a la operación; para los datos personales la Ley 1581 obliga a fijar finalidad y plazo.

## Consecuencias

- La política de tratamiento de datos, la autorización en el registro de la app y los canales de derechos de los titulares entran en la fase 0 o 1.
- Los costos de BigQuery crecen con el tiempo; a la escala prevista (decenas de conectores) son marginales, pero se revisan cada año.
