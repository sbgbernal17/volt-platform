# App Volt (`apps/mobile`)

App del conductor (iteración 7, ADR 0022) con Expo SDK 57 y React Native: registro e inicio de sesión con Identity Platform, consentimientos, mapa y lista de estaciones con estado en vivo, precio desagregado antes de cargar, lectura del QR del conector, inicio y parada de la carga con progreso en vivo, historial y recibos, medios de pago con Wompi (tarjeta con 3DS y Nequi), cobros pendientes con enlace de pago, avisos push y bandeja de avisos; español e inglés; marca VOLT en tema oscuro.

## Cómo correrla en desarrollo

1. API en marcha (`pnpm dev:api` desde la raíz) con `API_DEV_DRIVER_AUTH=true` y `PAYMENTS_PROVIDER=fake` en `.env` (identidad de desarrollo y emulador de pagos), o con `IDENTITY_PLATFORM_*` para entrar con correo y contraseña.
2. `pnpm --filter @volt/mobile start` y abrir en Expo Go (iOS o Android) o en el navegador (`w`). Sin `EXPO_PUBLIC_API_URL`, en Expo Go la app usa la máquina que sirve el bundle en el puerto 8080; con un túnel o un ambiente desplegado: `EXPO_PUBLIC_API_URL=https://api-staging.supercargadores.co pnpm --filter @volt/mobile start`.
3. En laboratorio: crear un conductor desde el back-office (Conductores → nuevo) y entrar con su id en la tarjeta "Laboratorio" de la pantalla de entrada; agregar la tarjeta de prueba `4242 4242 4242 4242`; escanear o escribir un `evseId` (por ejemplo `VOLT-BOG01-CP01-1`) y cargar con el simulador embebido.

Lo que no funciona en Expo Go ni en el navegador: los avisos push (hace falta una compilación de desarrollo con EAS y `extra.eas.projectId` en `app.json`); en el navegador tampoco el mapa nativo (se muestra la lista) ni la cámara (entrada manual del identificador).

## Comprobaciones

```bash
pnpm --filter @volt/mobile typecheck   # tsc con la configuración de Expo
pnpm --filter @volt/mobile test        # módulos puros: formatos, QR, cliente de Wompi, catálogos
pnpm --filter @volt/mobile export:web  # bundle web con Metro (lo corre CI)
```

## Estructura

- `app/`: rutas de Expo Router. `_layout.tsx` monta los proveedores y las guardas (sin sesión → `(auth)`; consentimientos pendientes → `consents`; con sesión → `(tabs)` y detalles).
- `src/api`: tipos de `/v1`, cliente y consultas con sondeo. `src/auth`: Identity Platform (SDK de Firebase con persistencia en AsyncStorage) y estado de la cuenta. `src/lib`: formatos de marca, lectura del QR, tokenización en Wompi y avisos push. `src/i18n`: catálogos es/en. `src/theme`: tokens de marca y componentes.
- `assets/`: iconos y logotipo generados desde `docs/marca/volt-logo-blanco.svg`.

## Compilaciones para las tiendas

Con las cuentas de Apple y Google Play (tarea del dueño): `npx eas build --profile preview` para TestFlight e Internal testing; `eas.json` y el `projectId` de EAS se añaden cuando existan las cuentas. Android con Google Maps necesita `android.config.googleMaps.apiKey` en `app.json` (clave restringida al paquete `co.supercargadores.volt`).
