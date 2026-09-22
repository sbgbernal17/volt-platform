# Tareas del dueño del proyecto

Lista de lo que solo tú puedes conseguir o decidir, ordenada por la iteración en la que se necesita. Marca cada casilla al entregar y anota la fecha. Nunca pegues llaves, contraseñas ni secretos en el chat ni en este repositorio: cárgalos donde se indica y en el chat basta con decir "ya están cargados".

## Hecho

- [x] 2026-09-22: el proveedor confirmó que los cargadores soportan OCPP 1.6J y que la URL del Central System se puede cambiar al CSMS propio.
- [x] 2026-09-22: cuenta de Wompi creada.
- [x] 2026-09-22: `main` es la rama predeterminada en GitHub.
- [x] 2026-09-22: cuenta de Google Cloud creada.

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

- [ ] Secretos de prueba de Wompi cargados en GitHub (y opcionalmente en el entorno de Claude Code).
- [ ] Preguntar a Wompi por escrito: flujo de tokenización de tarjeta con 3D Secure y cobros posteriores sin presencia del cliente, reglas y plazos de anulación y reembolso, Nequi como fuente de pago tokenizada, comisiones.

## Google Cloud: qué crear

Sigue `docs/google-cloud-setup.md` (facturación y presupuesto, tres proyectos, APIs, bucket de Terraform y acceso de GitHub Actions sin claves). Al terminar, carga en GitHub como **variables** (no secretos) las tres líneas que imprime el bloque de Cloud Shell por cada proyecto.

- [ ] Cuenta de facturación y presupuesto con alertas.
- [ ] Proyectos `volt-dev-*`, `volt-staging-*`, `volt-prod-*` creados y vinculados a facturación.
- [ ] Bloque de Cloud Shell ejecutado en los tres proyectos.
- [ ] Variables `GCP_PROJECT_ID_*`, `GCP_WIF_PROVIDER_*`, `GCP_DEPLOYER_SA_*` cargadas en GitHub.

## Qué probar de la iteración 2 (inventario y comisionamiento)

No hace falta hardware. En tu máquina, con Docker, Node 22 y pnpm:

1. `pnpm install && cp .env.example .env && pnpm services:up && pnpm db:migrate`.
2. `pnpm lint && pnpm typecheck && DATABASE_URL=postgres://volt:volt@localhost:5432/volt REDIS_URL=redis://localhost:6379 pnpm test`: deben pasar todas las suites, incluida `apps/api/src/commissioning.e2e.test.ts` (un simulador pasa de inventariado a operativo y se detecta deriva).
3. Sigue el paso a paso de `lab/README.md` ("Simulador embebido"): crea sede, plantilla y cargador, emite la credencial, arranca el simulador con esa clave, comisiona desde la API y aprueba el cargador. Comprueba que con una clave equivocada el simulador no entra y que al cambiar `HeartbeatInterval` en el simulador la sincronización abre una alarma `CONFIG_DRIFT`.
4. Cuando tengas el cargador de laboratorio real: en vez del simulador, configura en él la URL `ws://<ip-de-tu-pc>:9220/ocpp/<chargeBoxId>` (solo en red local; en Internet será `wss://`), usuario = `chargeBoxId`, contraseña = la clave emitida, y repite los pasos 3 a 6 del laboratorio. Anota qué keys responden `NotSupported` o `Rejected`: eso alimenta la matriz de conformidad por modelo.
5. Si algo falla, copia el error del terminal (sin la clave) en la sesión.

## Para la próxima sesión (iteraciones 1 a 3)

- [ ] **Proveedor de cargadores.** Enviar por escrito la lista de requisitos de `docs/00-resumen-ejecutivo.md` §8 para los modelos de 180 kW y 40 kW y entregarme lo que responda: manuales de instalador, procedimiento para cambiar URL, identidad y credenciales, perfiles de seguridad soportados, salida completa de `GetConfiguration`, measurands DC (`SoC`, `Power.Offered`), reparto de potencia entre las dos mangueras, mensajes `DataTransfer` propietarios, proceso de firmware.
- [ ] **Cargador de laboratorio.** Instalarlo con red propia y anotar fabricante, modelo, número de serie, versión de firmware y cómo se accede a su configuración. Si es posible, acceso remoto al laboratorio para pruebas contra staging.
- [ ] **Tipo de conector** de los equipos (CCS2 esperado) y si el modelo de 180 kW carga dos vehículos a la vez y con qué reparto.
- [ ] **Precios por kWh por franja horaria** que quieres publicar al inicio (el archivo `packages/tariff-engine/fixtures/volt-colombia-tarifa-base.json` trae valores de ejemplo).

## Para las iteraciones 5 a 7 (pagos y app)

- [ ] **Contador.** Tratamiento de IVA del servicio de carga, retenciones, documento electrónico por cobro (factura electrónica de venta o documento equivalente), numeración y resolución de facturación. Elegir el proveedor tecnológico de facturación electrónica con API y cargar sus credenciales de prueba como secretos de GitHub (te diré los nombres).
- [ ] **Apple y Google Play.** Cuentas de desarrollador a nombre de la empresa con acceso para mí; nombre "Volt" e identificador de paquete (por ejemplo `co.volt.app`).
- [ ] **Identidad visual** de la app (logo, colores, tipografía, pantallas) para la iteración 7.

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
| Llaves y secretos (Wompi, DIAN, tiendas) | Secretos de GitHub Actions (pruebas) o Secret Manager de Google Cloud (producción); en el chat solo confirma que están cargados |
| Identificadores no secretos (IDs de proyecto, proveedor WIF, cuentas de servicio) | Variables de GitHub Actions o directamente en el chat |
| Decisiones nuevas | Dímelas en la sesión; yo las registro como ADR en `docs/adr/` |
