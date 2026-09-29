# Back-office del operador

Aplicación web (React + Vite) para operar la plataforma: mapa y lista con estado en vivo, sedes, cargadores (comisionamiento, configuración y deriva, comandos con confirmación, bitácora), sesiones y costo, tarifas con simulador, parámetros por nivel, pagos y deudas, conductores, alarmas, auditoría y personal. Español e inglés (ADR 0005). Iteración 6 (ADR 0021).

## Correr en local

```bash
pnpm dev:api          # la API en http://localhost:8080 con API_ADMIN_TOKEN en .env
pnpm dev:backoffice   # Vite en http://localhost:5173; reenvía /admin/v1 a la API
```

Entra con el token de administración (sección "Laboratorio" de la pantalla de entrada) o, si la API tiene `IDENTITY_PLATFORM_PROJECT_ID` y `IDENTITY_PLATFORM_API_KEY`, con correo y contraseña de Identity Platform (y segundo factor TOTP para ADMIN y OPERATIONS).

## Autenticación y permisos

- La API decide rol y permisos en cada petición (`GET /admin/v1/me`); la interfaz solo muestra u oculta acciones según `permissions`.
- Con Identity Platform, el ID token viaja en `Authorization: Bearer`; la SPA lo renueva con el SDK de Firebase. El primer inicio de sesión vincula la invitación por correo verificado.
- El token de laboratorio se guarda en `sessionStorage` (solo la pestaña) y nunca en producción.

## Mapas y tarifas (iteración 9, ADR 0024)

- Los mapas (panel, detalle de sede y selector de coordenadas al crear sedes) usan Maps JavaScript API. La clave de navegador es pública por diseño (restringida por dominio y solo a esa API): en el contenedor llega por `GOOGLE_MAPS_BROWSER_KEY` y se escribe en `config.js`; en desarrollo se toma de `VITE_GOOGLE_MAPS_BROWSER_KEY`. Sin clave, el mapa muestra un aviso y las listas hacen el trabajo. La CSP de `nginx.conf` sigue la guía de Google para esa API.
- El editor de tarifas (`src/lib/tariff-form.ts`) convierte el formulario (precio por kWh con franjas, ocupación, cargos, IVA y topes) en la definición OCPI y de vuelta; lo que el formulario no cubre se edita como JSON. Antes de guardar se valida con la API y se simula un ejemplo fijo.

## Construcción y despliegue

`pnpm --filter @volt/backoffice build` deja la SPA en `dist/`. El `Dockerfile` la sirve con nginx en el puerto 8080; las variables `API_BASE_URL` y `GOOGLE_MAPS_BROWSER_KEY` del contenedor escriben `config.js` (origen de la API y clave pública de Google Maps) al arrancar, así la misma imagen sirve para staging y producción (iteración 8).

## Pruebas

`pnpm --filter @volt/backoffice test` (Vitest, módulos puros: i18n, enrutador, formato, cliente de API, editor de tarifas) y `typecheck`. La prueba de punta a punta de la API cubre autenticación, RBAC y auditoría (`apps/api/src/staff.e2e.test.ts`).
