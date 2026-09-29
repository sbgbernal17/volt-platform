# 0024. Diseño y experiencia de uso: mapas de Google, estación de pruebas, editor de tarifas y correos con marca

- Estado: aceptada (29 de septiembre de 2026)
- Iteración: 9
- Relacionados: ADR 0005 (marca e idiomas), 0011 y 0012 (modelo de tarifas), 0017 y 0018 (precios), 0019 (hosts), 0021 (back-office), 0022 (app Volt), 0023 (infraestructura); TAR §7, ARQ §1.4

## Contexto

Con dev y staging desplegados (ADR 0023), el dueño recorrió el back-office y la app y encontró lo que frena la operación diaria antes que la facturación electrónica: el mapa del back-office usaba OpenStreetMap y no Google; la versión web de la app no mostraba mapa; no había forma de hacer una carga de prueba desde la app porque ningún cargador visible tenía precio; la pantalla de tarifas exigía escribir JSON OCPI a mano y no explicaba las asignaciones; las listas de cargadores no mostraban potencia ni tipo de conector; y los correos de verificación salían con la plantilla genérica de Google. La iteración 9 se redefine como iteración de diseño y experiencia de uso en las dos plataformas; la facturación DIAN y la salida a producción pasan a la iteración 10.

## Decisiones

1. **Google Maps en las dos webs.** El back-office y la versión web de la app usan Maps JavaScript API (la app nativa ya usa los SDK de Google Maps). Terraform crea por ambiente una clave de navegador (`google_apikeys_key.maps_browser`) restringida por referrer a `admin-*` y `app-*` y solo a esa API; es pública por diseño y viaja al back-office por `config.js` (`GOOGLE_MAPS_BROWSER_KEY` del contenedor) y a la app por `GET /v1/config` (`maps.browserKey`). Sin clave, ambas muestran un aviso y la lista hace el trabajo. Se retira Leaflet: los mosaicos de Google no pueden usarse fuera de su SDK. Se usan marcadores clásicos (`google.maps.Marker`, deprecados pero soportados sin fecha de retiro) porque los marcadores avanzados exigen un *Map ID* creado en la consola; cuando el dueño lo cree se migra. La CSP de nginx sigue la guía de Google para Maps JavaScript API. Costo: la capa gratuita mensual de Maps Platform cubre el uso previsto del back-office y de la app web.

2. **Estación de pruebas virtual fuera de producción.** El cargador sintético (ADR 0023, decisión 14) se publica en la app en dev y staging (`SYNTHETIC_VISIBLE_IN_APP=true`, variable `synthetic_visible_in_app` de Terraform) como "Estación de pruebas Volt (virtual)" en Itagüí, y su alta garantiza la tarifa base `VOLT-BASE` asignada a toda la plataforma. Así el dueño hace una carga completa desde la app (precio, inicio remoto, progreso, parada, liquidación y cobro emulado o en sandbox) sin cargador físico. La configuración lo rechaza en prod.

3. **Conectores con nombre comercial y potencia.** La lista de cargadores de la API de administración incluye el resumen de conectores; el back-office muestra en listas, tarjetas y formularios el estándar con su nombre comercial (CCS2, CCS1, GB/T, CHAdeMO, Tipo 2), el tipo de corriente y la potencia en kW (el alta pide kW y guarda W). La app usa las mismas etiquetas.

4. **Editor guiado de tarifas sobre el modelo OCPI.** El formulario cubre lo que la operación necesita hoy (precio por kWh con franjas horarias por hora y días, ocupación con cortesía y tope, cargo por sesión, precio por minuto, IVA, mínimo y máximo por sesión, descripción para el conductor) y genera la definición OCPI 2.2.1 con `x_volt` (TAR §7.1); cualquier otra regla (tramos por kWh, potencia o duración) se edita como JSON. Antes de guardar se valida con la API y se simula un ejemplo fijo (30 kWh en 45 minutos y 20 minutos de ocupación). Cada versión se resume en frases y las asignaciones se crean con selectores de sede, cargador, conector o tipo de conector y segmento, con textos que explican la precedencia. El modelo OCPI sigue siendo la fuente de verdad (ADR 0011): el formulario es una vista.

5. **Correos de Identity Platform con la identidad VOLT, como código.** Las plantillas de verificación de correo, contraseña nueva, cambio de correo y segundo factor viven en `infra/identity` (HTML del manual de marca, voz de usted) y el flujo *Correos de identidad* las aplica por ambiente con la API de administración de Identity Toolkit (`admin/v2/projects/{proyecto}/config`), junto con el `callbackUri` a la página propia `/auth/action` de la app web y los dominios autorizados. El desplegador recibe `roles/identityplatform.admin`. Se descartó montar un servicio de correo propio (SendGrid o similar) con enlaces generados por el Admin SDK: más piezas y una cuenta más para el mismo resultado; se reconsidera cuando lleguen los recibos por correo. Identity Platform admite un solo idioma de plantillas por proyecto: español (ADR 0005). El remitente con dominio propio (`noreply@supercargadores.co`) depende de registros DNS del dueño.

6. **Centro por defecto de los mapas** en el área metropolitana de Medellín, donde opera VOLT; con sedes cargadas el mapa se ajusta a ellas.

## Consecuencias

- Dependencias: se retiran `leaflet` y `@types/leaflet`; entra `@types/google.maps` (solo tipos, desarrollo). El script del mapa se carga en tiempo de ejecución desde `maps.googleapis.com`.
- Infraestructura: API `maps-backend.googleapis.com`, clave de navegador y variables nuevas por ambiente; hace falta `apply` en dev y staging y, cuando exista, en prod.
- Operación: el dueño prueba la carga completa desde la app en dev y staging; las sesiones de la estación virtual son sesiones reales de la base de datos (con cobro emulado en dev y sandbox de Wompi en staging).
- Deuda: marcadores avanzados con *Map ID*; dominio remitente propio; plantillas de correo en inglés cuando Identity Platform lo permita por usuario; recibos por correo (iteración 10 o posterior).
