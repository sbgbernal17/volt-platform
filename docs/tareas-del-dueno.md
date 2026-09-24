# Tareas del dueño del proyecto

Lista de lo que solo tú puedes conseguir o decidir, ordenada por la iteración en la que se necesita. Marca cada casilla al entregar y anota la fecha. Nunca pegues llaves, contraseñas ni secretos en el chat ni en este repositorio: cárgalos donde se indica y en el chat basta con decir "ya están cargados".

## Hecho

- [x] 2026-09-22: el proveedor confirmó que los cargadores soportan OCPP 1.6J y que la URL del Central System se puede cambiar al CSMS propio.
- [x] 2026-09-22: cuenta de Wompi creada.
- [x] 2026-09-22: `main` es la rama predeterminada en GitHub.
- [x] 2026-09-22: cuenta de Google Cloud creada.
- [x] 2026-09-22: llaves de prueba de Wompi cargadas como secretos del repositorio en GitHub; documentación en <https://docs.wompi.co/docs/colombia/inicio-rapido/>.
- [x] 2026-09-22: guía `docs/google-cloud-setup.md` ejecutada (facturación, proyectos, APIs, bucket de Terraform, Workload Identity Federation); variables `GCP_*` cargadas en GitHub; medición de latencia: `us-central1` la más rápida, adoptada como región principal (ADR 0015).
- [x] 2026-09-22: precios reales de la tarifa base: 1.350 COP/kWh de 05:00 a 20:00 y 1.200 COP/kWh de 20:00 a 05:00 (ADR 0018); publicados como versión 1 de `VOLT-BASE`, cambiables desde el back-office.
- [x] 2026-09-22: el servicio de carga está excluido de IVA (ADR 0018): la tarifa no lleva impuesto y el recibo no lo desglosa. Falta solo la nota escrita del contador para `docs/legal/`.
- [x] 2026-09-22: carga máxima de 4 horas (parámetro `session.max_duration_min` = 240) y ocupación cobrada mientras la pistola siga conectada, sin tope de tiempo (ADR 0018).
- [x] 2026-09-22: dominio `supercargadores.co` (zona en Netlify DNS) para `ocpp.`, `api.`, `admin.` y `app.` (ADR 0019). No hay nada que crear hasta la iteración 8.
- [x] 2026-09-22: conectores de las tres primeras estaciones: 1 = CCS1 + CCS2, 2 = 2 × CCS2, 3 = CCS2 + GB/T (ADR 0003, actualización). El inventario ya los modela por conector.
- [x] 2026-09-22: documento de Wompi (tokenización, 3DS, cobros posteriores, anulaciones, reembolsos, Nequi, comisiones) guardado en `docs/proveedor/wompi.md`; alimenta la iteración 5.
- [x] 2026-09-22: verificación de Google Cloud desde GitHub Actions con la identidad federada: los tres proyectos (`volt-dev-509415`, `volt-staging-509415`, `volt-prod-509415`) autentican y tienen la API de Identity Platform habilitada.
- [x] 2026-09-23: Identity Platform inicializado en los tres proyectos con correo y contraseña y un usuario administrador (`santiago.bernal@supercargadores.co`); verificado con el flujo *Verificación de Google Cloud*. Ese correo es el primer administrador del back-office (`API_STAFF_BOOTSTRAP_EMAIL`) en cada ambiente. Falta MFA TOTP (ver "Pendiente ahora").
- [x] 2026-09-23: llaves del sandbox de Wompi corregidas en GitHub; la prueba contra el sandbox real corre en cada push.
- [x] 2026-09-23: manual de marca entregado (sistema de diseño VOLT); copiado a `docs/marca/` y aplicado al back-office (colores, tipografía, logotipo). La app lo toma en la iteración 7.
- [x] 2026-09-23: correo remitente de recibos y avisos: `notificaciones@supercargadores.co` (ADR 0019, adición).
- [x] 2026-09-23: textos para el conductor propuestos en `docs/textos-app-conductor.md` (pendiente tu visto bueno; se ajustan cuando quieras).
- [x] 2026-09-23: iteración 7 entregada (ADR 0022): app Volt en `apps/mobile`, identidad del conductor con Identity Platform, consentimientos, notificaciones push. Los textos propuestos ya están dentro de la app y de los avisos.
- [x] 2026-09-24: MFA TOTP activado en Identity Platform (punto 0).
- [x] 2026-09-24: Google Play completo (punto 0b): cuenta, app Volt en Play Console y cuenta de servicio cargada cifrada en EAS. La cuenta de Apple sigue en verificación. El acceso para compilar y publicar no es una invitación personal: se hace con credenciales de API guardadas en EAS (ver 0b abajo).
- [x] 2026-09-24: términos y condiciones publicados en <https://supercargadores.co/terminos-y-condiciones> (punto 0d completo): ya es la URL por defecto de la app.
- [x] 2026-09-24: secreto `EXPO_TOKEN` cargado en GitHub (punto 0f): los flujos *Compilación de la app (EAS)* y *Clave de Google Maps (Android)* pueden correr desde el repositorio.
- [x] 2026-09-24: huella SHA-1 del keystore de EAS entregada (punto 0e, parcial): el flujo *Clave de Google Maps (Android)* ya creó la clave restringida en el proyecto prod (`volt-prod-509415`) y la guardó como variable sensible `GOOGLE_MAPS_ANDROID_API_KEY` en los ambientes development, preview y production de EAS; falta la huella de la firma de Google Play (ver 0e).
- [x] 2026-09-24: proyecto de EAS creado (punto 0c): `projectId` `6c086f3f-1a0f-4b7f-b663-16787a2f8180` enlazado en `apps/mobile/app.json` y perfiles de compilación en `apps/mobile/eas.json`. La carpeta `volt-app` que creó `create-expo-app` en tu máquina no hace falta: la app vive en `apps/mobile`; puedes borrarla.
- [x] 2026-09-24: política de tratamiento de datos publicada en <https://supercargadores.co/politica-de-datos> (punto 0d, parcial): ya es la URL por defecto de la app. Faltan los términos y condiciones.

## Pendiente ahora: lo que más me ayuda que entregues (iteraciones 6 a 8)

Ordenado por urgencia. Ninguno bloquea el desarrollo.

| # | Qué necesito | Para qué | Cómo entregarlo |
|---|---|---|---|
| 0b | **Apple, cuando termine la verificación**: crea la app "Volt" en App Store Connect (identificador `co.supercargadores.volt`), crea una clave de API en Usuarios y acceso → Integraciones → Claves de API (rol *App Manager*), descarga el `.p8` y anota *Key ID* e *Issuer ID*; luego, desde `apps/mobile`: `npx eas-cli credentials -p ios` → *App Store Connect API Key* → sube el archivo (queda cifrado en EAS; nunca en el repositorio) | Compilar para iOS y subir a TestFlight | Dime "listo Apple" y lanzamos la compilación de iOS |
| 0e | **Huella SHA-1 de la firma de Google Play**: Play Console → app Volt → Configuración → Firma de apps → *Certificado de clave de firma de apps* → huella SHA-1 (no es secreta). Con ella vuelvo a correr el flujo *Clave de Google Maps (Android)* con las dos huellas (la del keystore de EAS ya está) | Sin esa huella el mapa funciona en las compilaciones internas pero no en la versión que Google Play vuelve a firmar | La huella en el chat |
| 1 | **Nota escrita del contador** confirmando que el servicio de carga está excluido de IVA y qué retenciones aplican a los cobros por Wompi (retención en la fuente 1,5 %, ICA 0,2 % y retención de IVA 15 % con tarjeta según el documento de Wompi) | Cerrar impuestos, recibos y la conciliación de pagos (iteración 5) sin rehacer la facturación electrónica después. Mientras tanto el sistema ya opera sin IVA (ADR 0018) | Nota o correo del contador en `docs/legal/` sin datos sensibles |
| 2 | **Preguntas abiertas a tu ejecutivo de Wompi** (sección 6 de `docs/proveedor/wompi.md`): qué procesador queda asignado (¿RBM?) y en qué modelo (Agregador o Gateway), responsabilidad por contracargo con y sin 3RI, plazo máximo real de reembolsos y si hay costo por reembolso o contracargo; y pedir al equipo de fraude la **activación de 3DS en fuentes de pago** para producción | Definir el flujo de cobro al final de la carga (iteración 5) y evitar sorpresas en tasa de aprobación y contracargos | Sus respuestas añadidas al final de `docs/proveedor/wompi.md` |

## Proveedor de cargadores y equipos (cuando los tengas)

- [ ] **Requisitos por escrito al proveedor** (`docs/00-resumen-ejecutivo.md` §8) para los modelos de 180 kW y 40 kW; y entregarme lo que responda: manuales de instalador, cómo cambiar URL, identidad y credenciales, perfiles de seguridad, salida completa de `GetConfiguration`, measurands DC (`SoC`, `Power.Offered`), reparto de potencia entre mangueras, mensajes `DataTransfer` propietarios, firmware. Preguntas específicas de tarifas en `docs/04-tarifas-y-precios-dinamicos.md` §8 (unidad del medidor, `Finishing`/`SuspendedEV`, cola offline).
- [ ] **Tipo de conector** de los equipos (CCS2 esperado) y si el modelo de 180 kW carga dos vehículos a la vez y con qué reparto.
- [ ] **Cargador de laboratorio (cuando exista).** Hoy no hay ninguno ni forma de montar un simulador en tu lado, así que no hace falta nada: las pruebas se hacen con el simulador embebido en CI y, desde la iteración 8, con un cargador sintético en staging. Cuando llegue el primer equipo, anota fabricante, modelo, número de serie, versión de firmware y cómo se accede a su configuración, y avísame para conectarlo a staging con la credencial que emita la API.

## Wompi: cómo subir las llaves

Las llaves del ambiente de pruebas (sandbox) se usan en las pruebas automáticas de la iteración 5. Las de producción solo se usan en la iteración 8 y van a Secret Manager de Google Cloud, nunca a GitHub.

1. En el panel de Wompi entra a **Desarrolladores** y copia, del ambiente de **pruebas**: llave pública (`pub_test_…`), llave privada (`prv_test_…`), **secreto de integridad** y **secreto de eventos**.
2. En GitHub: repositorio → **Settings → Secrets and variables → Actions → New repository secret**. Crea cuatro secretos con exactamente estos nombres:
   - `WOMPI_PUBLIC_KEY_TEST`
   - `WOMPI_PRIVATE_KEY_TEST`
   - `WOMPI_INTEGRITY_SECRET_TEST`
   - `WOMPI_EVENTS_SECRET_TEST`
3. Opcional, para que yo pueda probar contra el sandbox desde mis sesiones: en Claude Code (claude.ai/code) → configuración del entorno del repositorio → variables de entorno, las mismas cuatro variables. Nunca las mostraré en el chat ni en logs.
4. Las llaves de **producción** (`pub_prod_…`, `prv_prod_…` y sus secretos) no se suben todavía. En la iteración 8 se crean en Consola de Google Cloud → Seguridad → Secret Manager del proyecto prod, con los nombres que te indicaré.
5. Si una llave llega a quedar expuesta en cualquier lugar público, regenérala en Wompi de inmediato.
6. En el panel de Wompi, la URL de eventos (webhook) del sandbox se configura en la iteración 5, cuando exista el endpoint en staging.

- [x] 2026-09-22: secretos de prueba de Wompi cargados en GitHub. CI comprueba su presencia (sin mostrar valores) en cada ejecución en `main`; si alguno aparece como "no configurado", revisa el nombre.
- [ ] Preguntar a Wompi por escrito: flujo de tokenización de tarjeta con 3D Secure y cobros posteriores sin presencia del cliente, reglas y plazos de anulación y reembolso, Nequi como fuente de pago tokenizada, comisiones.

## Google Cloud: qué crear

Sigue `docs/google-cloud-setup.md` (facturación y presupuesto, tres proyectos, APIs, bucket de Terraform y acceso de GitHub Actions sin claves). Al terminar, carga en GitHub como **variables** (no secretos) las tres líneas que imprime el bloque de Cloud Shell por cada proyecto.

- [x] 2026-09-22: cuenta de facturación y presupuesto con alertas.
- [x] 2026-09-22: proyectos creados y vinculados a facturación.
- [x] 2026-09-22: bloque de Cloud Shell ejecutado en los tres proyectos.
- [x] 2026-09-22: variables `GCP_PROJECT_ID_*`, `GCP_WIF_PROVIDER_*`, `GCP_DEPLOYER_SA_*` cargadas en GitHub.
- [x] Dominio: `supercargadores.co` con la zona en Netlify DNS (ADR 0019); en la iteración 8 te doy los registros `A` que hay que añadir.

## Qué probar de la iteración 2 (inventario y comisionamiento)

No hace falta hardware. En tu máquina, con Docker, Node 22 y pnpm:

1. `pnpm install && cp .env.example .env && pnpm services:up && pnpm db:migrate`.
2. `pnpm lint && pnpm typecheck && DATABASE_URL=postgres://volt:volt@localhost:5432/volt REDIS_URL=redis://localhost:6379 pnpm test`: deben pasar todas las suites, incluida `apps/api/src/commissioning.e2e.test.ts` (un simulador pasa de inventariado a operativo y se detecta deriva).
3. Sigue el paso a paso de `lab/README.md` ("Simulador embebido"): crea sede, plantilla y cargador, emite la credencial, arranca el simulador con esa clave, comisiona desde la API y aprueba el cargador. Comprueba que con una clave equivocada el simulador no entra y que al cambiar `HeartbeatInterval` en el simulador la sincronización abre una alarma `CONFIG_DRIFT`.
4. Este paso queda para cuando exista un cargador real. Entonces, en vez del simulador, configura en él la URL `ws://<ip-de-tu-pc>:9220/ocpp/<chargeBoxId>` (solo en red local; en Internet será `wss://`), usuario = `chargeBoxId`, contraseña = la clave emitida, y repite los pasos 3 a 6 del laboratorio. Anota qué keys responden `NotSupported` o `Rejected`: eso alimenta la matriz de conformidad por modelo.
5. Si algo falla, copia el error del terminal (sin la clave) en la sesión.

## Qué probar de la iteración 3 (sesiones de carga)

1. `pnpm lint && pnpm typecheck && DATABASE_URL=postgres://volt:volt@localhost:5432/volt REDIS_URL=redis://localhost:6379 pnpm test`: pasan las pruebas de sesiones (`apps/api/src/sessions.e2e.test.ts` y `apps/ocpp-gateway/src/transactions.db.test.ts`).
2. Con el simulador operativo, sigue "Sesión de carga de punta a punta" en `lab/README.md`: crea un conductor, inicia la carga desde la API pública con la identidad de desarrollo, mira el progreso por SSE y detén la carga. Comprueba en `/admin/v1/sessions` que la sesión queda `ENDED` con energía y motivo `Remote`.
3. Lo que aún no verás: el costo de la sesión (iteración 4) y el cobro (iteración 5).

## Qué probar de la iteración 4 (tarifas y costo de las sesiones)

1. `pnpm lint && pnpm typecheck && DATABASE_URL=postgres://volt:volt@localhost:5432/volt REDIS_URL=redis://localhost:6379 pnpm test`: pasan las pruebas del motor (`packages/tariff-engine`, incluido el ejemplo del capítulo TAR al centavo), las de precios sobre la base de datos (`packages/csms/src/pricing/pricing.test.ts`) y la aceptación por la API (`apps/api/src/pricing.e2e.test.ts`: la carga termina, corre la gracia, la ocupación se cobra por minuto y el tope de exposición detiene la sesión).
2. Con el simulador operativo, sigue "Tarifas y costo de una sesión" en `lab/README.md`: publica la tarifa base con un solo comando, mira en `/v1/evses/{evseId}` lo que verá la app (precio por kWh ahora, franjas, ocupación por minuto, gracia, tope), inicia una carga y observa el costo en curso; al terminar, la sesión queda `SETTLED` con sus líneas (`/v1/sessions/{id}/cost`).
3. Cambia un precio: crea una versión nueva de la tarifa con tus cifras (`POST /admin/v1/tariffs/{id}/versions`) y publícala; las sesiones que ya empezaron conservan la tarifa que vieron (snapshot) y las nuevas toman la versión nueva. Cambia el tope de exposición (`PUT /admin/v1/parameters/pricing.exposure_limit_minor`) a una cifra pequeña y comprueba que la plataforma detiene la carga.
4. Lo que aún no verás: el cobro real (iteración 5, Wompi) y los recibos (iteración 5). Los precios de la tarifa base son valores de ejemplo hasta que entregues la tabla del punto 1 de "Pendiente ahora".

## Qué probar de la iteración 6 (back-office)

1. En local: `pnpm dev:api` (con `API_ADMIN_TOKEN` y `PAYMENTS_PROVIDER=fake` en `.env`) y `pnpm dev:backoffice`; abre <http://localhost:5173>, entra con el token de administración y declara un actor (por ejemplo `staff:sebastian`). Recorre: Sedes → nueva sede; Cargadores → nuevo cargador → Emitir credencial → pestañas; Tarifas → Crear tarifa base de Volt → Simulador (60 min, 40.000 Wh: debes ver 54.000 COP de día); Parámetros → cambia `pricing.exposure_limit_minor`; Personal → invita a alguien; Auditoría → verás cada acción con tu actor y el botón "Verificar cadena" debe decir "Cadena íntegra". Cambia el idioma a inglés desde la barra lateral.
2. Con Identity Platform inicializado en dev (punto 0 de "Pendiente ahora"): en `.env` pon `IDENTITY_PLATFORM_PROJECT_ID` (id del proyecto dev), `IDENTITY_PLATFORM_API_KEY` (Consola → Identity Platform → Detalles de configuración de la aplicación → apiKey; es pública) y `API_STAFF_BOOTSTRAP_EMAIL` con tu correo; arranca la API y entra con correo y contraseña. La primera vez la API te pedirá verificar el correo (botón "Reenviar correo de verificación") y, como ADMIN, activar el segundo factor con una app de autenticación (Google Authenticator, Authy, 1Password). Después de activarlo vuelves a entrar con código.
3. Roles: invita un segundo correo como READ_ONLY y comprueba que solo ve; como SUPPORT, que solo puede enviar RemoteStop, desbloqueo y TriggerMessage y que una devolución por encima de `billing.support_refund_limit_minor` (200.000 COP) se rechaza.
4. Lo que aún no verás: Identity-Aware Proxy delante del back-office, exportación de la auditoría a un bucket con retención bloqueada y el despliegue en `admin.supercargadores.co` (iteración 8); las pantallas de reportes y exportación CSV (fase 2).

## Qué probar de la iteración 7 (app Volt)

1. `pnpm lint && pnpm typecheck && DATABASE_URL=postgres://volt:volt@localhost:5432/volt REDIS_URL=redis://localhost:6379 pnpm test`: pasan `apps/api/src/driver-identity.e2e.test.ts` (alta automática, tenant, correo verificado, consentimientos, vinculación segura, dispositivos, bandeja, borrado), `apps/worker/src/jobs/push.test.ts` (avisos de inicio, ocupación, liquidación y cobro en el idioma de cada dispositivo, token inválido, clases por parámetro, reintento) y las pruebas puras de la app (`apps/mobile`: formatos, QR, cliente de Wompi, catálogos). `pnpm --filter @volt/mobile export:web` construye el bundle web.
2. En tu computador con la API en marcha (`pnpm dev:api` con `API_DEV_DRIVER_AUTH=true` y `PAYMENTS_PROVIDER=fake`): `pnpm dev:mobile` y sigue "App Volt (iteración 7)" en `lab/README.md`, en Expo Go (instálalo en tu teléfono; misma red Wi-Fi) o en el navegador (`w`). Recorrido: entrar con el id de un conductor creado en el back-office → consentimientos → lista de estaciones → conector con el precio desagregado → agregar la tarjeta 4242 → iniciar carga → progreso en vivo → detener → liquidar y cobrar desde el back-office → recibo en Historial. Cambia el idioma en Cuenta.
3. Con Identity Platform (mismas variables del back-office en `.env`): crea la cuenta desde la app con tu correo y contraseña; recibirás el correo de verificación de Google; hasta verificarlo puedes mirar el mapa pero no pagar ni cargar. Si el correo ya existía como conductor creado por el personal, la app entra en esa cuenta solo después de verificarlo.
4. Con el sandbox de Wompi en la API (`PAYMENTS_PROVIDER=wompi` y las llaves de prueba): la tarjeta se tokeniza directo contra Wompi desde la app (el número nunca pasa por la API) y Nequi pide aprobar en la app Nequi (en sandbox, cualquier celular y se aprueba sola).
5. Lo que aún no verás: avisos push en el teléfono (necesitan una compilación de desarrollo con EAS: tareas 0b y 0c), el mapa en el navegador (se muestra la lista), enlaces universales verificados y `app.supercargadores.co` (iteración 8), inicio de sesión con Google o Apple (después del piloto).

## Qué probar de la iteración 5 (cobros con Wompi)

1. `pnpm lint && pnpm typecheck && DATABASE_URL=postgres://volt:volt@localhost:5432/volt REDIS_URL=redis://localhost:6379 pnpm test`: pasan las pruebas del paquete de pagos (`packages/payments`), las de cobro sobre la base de datos (`packages/csms/src/billing/billing.test.ts`) y la aceptación por la API con el emulador (`apps/api/src/payments.e2e.test.ts`: sin tarjeta no se carga, alta de tarjeta, cobro aprobado con recibo, cobro rechazado con deuda y bloqueo, enlace de pago y webhook que desbloquea, devolución y conciliación).
2. En GitHub, la acción de CI ejecuta además `apps/api/src/wompi.sandbox.test.ts` contra el sandbox real con las llaves de prueba que ya subiste: tokeniza la tarjeta 4242, crea la fuente de pago, cobra 1.000 COP y anula. Si ese caso falla, es la señal de que algún detalle del API de Wompi difiere de lo documentado (firma, formato de respuesta) y lo ajusto con el mensaje de error; no afecta a las demás pruebas.
   - **23-09-2026:** con las llaves corregidas, el sandbox real aceptó la tokenización y la fuente de pago; el cobro de 1.000 COP fue rechazado por validación (Wompi exige mínimo 1.500 COP), así que la prueba cobra 5.000 COP y el parámetro `billing.min_charge_minor` queda en 1.500 por defecto (las sesiones más baratas se condonan). Si vuelve a fallar, el registro de CI ya muestra el campo que Wompi rechaza.
   - **Hallazgo de la primera corrida:** los secretos `WOMPI_PUBLIC_KEY_TEST` y `WOMPI_PRIVATE_KEY_TEST` del repositorio no empiezan por `pub_test_` y `prv_test_`, que son los prefijos de las llaves del sandbox de Wompi (las de producción empiezan por `pub_prod_` y `prv_prod_`). Por seguridad la prueba se omite con un aviso en el registro de CI y nunca cobra contra producción. Revisa en el panel de Wompi (Desarrolladores → Llaves API, ambiente *Sandbox*) y vuelve a guardar los cuatro secretos con las llaves del sandbox, sin espacios ni saltos de línea; con eso la prueba corre sola en el siguiente push. No pegues las llaves en el chat.
3. En el panel de Wompi (sandbox): registra la URL de eventos cuando exista el dominio (`https://api-staging.supercargadores.co/v1/webhooks/wompi`); mientras tanto, en local puedes probar con un túnel (`ngrok http 8080`) siguiendo "Pagos con Wompi" en `lab/README.md`.
4. Pide al equipo de fraude de Wompi la **activación de 3DS en fuentes de pago** para el comercio (sandbox y, más adelante, producción); sin ella los cobros posteriores no viajan bajo 3RI (solo Mastercard) y la responsabilidad por contracargo cambia (sección 6 de `docs/proveedor/wompi.md`).
5. Lo que aún no verás: pantallas de pagos en el back-office (iteración 6), el widget de Wompi y el reto 3DS en la app (iteración 7) y la factura electrónica DIAN (puerto preparado, sin adaptador).

## Para las iteraciones 5 a 7 (pagos y app)

- [ ] **Contador.** Tratamiento de IVA del servicio de carga, retenciones, documento electrónico por cobro (factura electrónica de venta o documento equivalente), numeración y resolución de facturación. Elegir el proveedor tecnológico de facturación electrónica con API y cargar sus credenciales de prueba como secretos de GitHub (te diré los nombres).
- [ ] **Apple y Google Play.** Cuentas de desarrollador a nombre de la empresa con acceso para mí; nombre "Volt" e identificador de paquete `co.supercargadores.volt` (ver 0b y 0c en "Pendiente ahora").
- [x] 2026-09-23: **Identidad visual** de la app entregada (manual de marca) y aplicada.

## Legal y regulatorio (antes de salir a producción)

- [ ] **Asesor legal.** Con las Resoluciones MME 40123 de 2024 y 40559 de 2025: (a) si exigir cuenta y tarjeta registrada cumple "acceso y pago sin restricciones"; (b) si OCPP 1.6J cumple "última versión estable"; (c) qué información se reporta, a quién, en qué formato y desde cuándo; (d) política de tratamiento de datos, texto de autorización para la app y transferencia internacional a la región de Google Cloud; (e) inscripción en el Registro Nacional de Bases de Datos si aplica.
- [ ] **Registro como prestador del servicio de carga** (pospuesto; retomar en la fase 1).
- [ ] **Términos y condiciones y política de privacidad** de la app Volt.

## GitHub

- [ ] Settings → Code security: activar Dependabot alerts, secret scanning y push protection.

## Cómo entregarme cada cosa

| Tipo | Cómo |
|---|---|
| Documentos del proveedor, manuales, respuestas legales o contables | Súbelos a `docs/proveedor/` o `docs/legal/` en el repositorio (sin secretos) o compártelos en la sesión |
| Llaves y secretos (Wompi, DIAN) | Secretos de GitHub Actions (pruebas) o Secret Manager de Google Cloud (producción); en el chat solo confirma que están cargados |
| Credenciales de las tiendas (cuenta de servicio de Google Play, clave de API de App Store Connect) | Cifradas en EAS con `npx eas-cli credentials` desde `apps/mobile`; nunca en el repositorio ni en el chat |
| Huellas SHA-1 de certificados, ids de proyecto, URL públicas | Directamente en el chat (no son secretos) |
| Identificadores no secretos (IDs de proyecto, proveedor WIF, cuentas de servicio) | Variables de GitHub Actions o directamente en el chat |
| Decisiones nuevas | Dímelas en la sesión; yo las registro como ADR en `docs/adr/` |
