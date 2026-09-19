# Tareas del dueño del proyecto

Lista de lo que solo tú puedes conseguir o decidir, ordenada por la iteración en la que se necesita. Marca cada casilla al entregar y anota la fecha. Nunca pegues llaves, contraseñas ni secretos en el chat ni en este repositorio: entrégalos por un gestor de contraseñas compartido o directamente en Secret Manager de Google Cloud cuando exista el proyecto; en el chat basta con decir "ya está cargado en X".

## Para la próxima sesión (necesario para las iteraciones 1 a 3)

- [ ] **Proveedor de cargadores.** Enviar por escrito la lista de requisitos de `docs/00-resumen-ejecutivo.md` §8 (detalle en `docs/01-cargadores-y-migracion.md` §3) para los modelos de 180 kW y 40 kW, y entregarme lo que responda: manuales de instalador, procedimiento para cambiar la URL del Central System, la identidad y las credenciales, perfiles de seguridad soportados, salida completa de `GetConfiguration`, measurands DC (`SoC`, `Power.Offered`), cómo reparte la potencia el gabinete entre las dos mangueras, mensajes `DataTransfer` propietarios, proceso de firmware, y confirmación escrita de que aceptan operar con un CSMS propio.
- [ ] **Cargador de laboratorio.** Instalarlo con red propia, anotar fabricante, modelo, número de serie, versión de firmware y cómo se accede a su configuración. Si es posible, acceso remoto al laboratorio (VPN o red con IP fija) para pruebas contra staging.
- [ ] **Confirmar el tipo de conector** de los equipos (CCS2 esperado) y si el modelo de 180 kW puede cargar dos vehículos a la vez y con qué reparto.

## Para las iteraciones 5 a 7 (pagos y app)

- [ ] **Wompi.** Abrir la cuenta de comercio a nombre de la empresa y activar el sandbox. Cargar en el gestor de secretos: llave pública y privada de prueba (`pub_test_…`, `prv_test_…`), secreto de integridad y secreto de eventos del ambiente de pruebas. Preguntar a Wompi por escrito: flujo de tokenización de tarjeta con 3D Secure y cobros posteriores sin presencia del cliente, reglas y plazos de anulación y reembolso, disponibilidad de Nequi como fuente de pago tokenizada, y comisiones.
- [ ] **Contador.** Definir con él: tratamiento de IVA del servicio de carga, retenciones aplicables, si por cada cobro se emite factura electrónica de venta o documento equivalente electrónico, y numeración y resolución de facturación. Elegir el proveedor tecnológico de facturación electrónica con API (por ejemplo Siigo, Alegra, Factus, Dataico u otro que el contador recomiende) y entregarme las credenciales del ambiente de pruebas por el gestor de secretos.
- [ ] **Apple y Google Play.** Abrir las cuentas de desarrollador a nombre de la empresa (Apple Developer Program y Google Play Console) y darme acceso como desarrollador. Reservar el nombre "Volt" y el identificador de paquete (por ejemplo `co.volt.app`, a definir con el dominio).
- [ ] **Identidad visual.** Cuando esté lista, compartir el diseño de la app (logo, colores, tipografía, pantallas) para la iteración 7.

## Para la iteración 8 (infraestructura)

- [ ] **Google Cloud.** Crear la organización o usar la cuenta de la empresa, y crear tres proyectos: `volt-dev`, `volt-staging`, `volt-prod`, con cuenta de facturación, presupuesto mensual y alertas. Darme acceso de despliegue mediante Workload Identity Federation desde GitHub Actions (sin claves de cuentas de servicio); te dejaré el procedimiento exacto en la iteración 8.
- [ ] **Dominio.** Comprar o asignar el dominio y delegar el DNS a Cloud DNS cuando exista el proyecto. Subdominios previstos: `ocpp.`, `api.`, `admin.`, `app.`.
- [ ] **Región.** Confirmar `us-east1` tras medir latencia desde Bogotá (te dejaré un comando sencillo para medirla).

## Legal y regulatorio (antes de salir a producción)

- [ ] **Asesor legal.** Leer las Resoluciones MME 40123 de 2024 y 40559 de 2025 y responder por escrito: (a) si exigir cuenta y tarjeta registrada cumple "acceso y pago sin restricciones"; (b) si OCPP 1.6J cumple "última versión estable"; (c) qué información hay que reportar, a quién, en qué formato y desde cuándo; (d) política de tratamiento de datos personales, texto de autorización para la app y tratamiento de la transferencia internacional a la región de Google Cloud; (e) si aplica la inscripción en el Registro Nacional de Bases de Datos.
- [ ] **Registro como prestador del servicio de carga** ante la autoridad que corresponda (pospuesto por decisión propia; retomar en la fase 1).
- [ ] **Términos y condiciones y política de privacidad** de la app Volt, revisados por el asesor legal, para publicarlos en las tiendas y en la app.

## GitHub

- [ ] Cambiar la rama predeterminada a `main`: Settings → General → Default branch. Avísame para borrar la rama de trabajo.
- [ ] Activar en Settings → Code security: Dependabot alerts, secret scanning y push protection.

## Cómo entregarme cada cosa

| Tipo | Cómo |
|---|---|
| Documentos del proveedor, manuales, respuestas legales o contables | Súbelos a `docs/proveedor/` o `docs/legal/` en el repositorio (sin secretos) o compártelos en la sesión |
| Llaves y secretos (Wompi, DIAN, Google Cloud, tiendas) | Gestor de contraseñas compartido o Secret Manager; en el chat solo confirma que están cargados |
| Decisiones nuevas | Dímelas en la sesión; yo las registro como ADR en `docs/adr/` |
