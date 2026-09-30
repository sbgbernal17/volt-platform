# App Volt (`apps/mobile`)

App del conductor (iteración 7, ADR 0022) con Expo SDK 57 y React Native: registro e inicio de sesión con Identity Platform, consentimientos, mapa y lista de estaciones con estado en vivo, precio desagregado antes de cargar, lectura del QR del conector, inicio y parada de la carga con progreso en vivo, historial y recibos, medios de pago con Wompi (tarjeta con 3DS y Nequi), cobros pendientes con enlace de pago, avisos push y bandeja de avisos; español e inglés; marca VOLT en tema oscuro. El 30-09-2026 (ADR 0025) la interfaz se rehízo a partir del handoff de UI/UX del dueño: sistema de diseño propio en `src/theme`, barra de pestañas con el botón Cargar, mapa a pantalla completa con hoja de estación, flujo de carga con anillo de progreso y modo invitado (explorar sin cuenta). El mismo día, a pedido del dueño: tres pestañas (Mapa · Cargar · Cuenta, con Actividad dentro de Cuenta), cámara para el QR también en el navegador, "hasta 180 kW" con potencia compartida por gabinete (ADR 0026), documento de identidad y factura electrónica en el perfil (ADR 0027) y recibo en PDF descargable o compartible (ADR 0028).

## Cómo correrla en desarrollo

1. API en marcha (`pnpm dev:api` desde la raíz) con `API_DEV_DRIVER_AUTH=true` y `PAYMENTS_PROVIDER=fake` en `.env` (identidad de desarrollo y emulador de pagos), o con `IDENTITY_PLATFORM_*` para entrar con correo y contraseña.
2. `pnpm --filter @volt/mobile start` y abrir en Expo Go (iOS o Android) o en el navegador (`w`). Sin `EXPO_PUBLIC_API_URL`, en Expo Go la app usa la máquina que sirve el bundle en el puerto 8080; con un túnel o un ambiente desplegado: `EXPO_PUBLIC_API_URL=https://api-staging.supercargadores.co pnpm --filter @volt/mobile start`.
3. En laboratorio: crear un conductor desde el back-office (Conductores → nuevo) y entrar con su id en la tarjeta "Laboratorio" de la pantalla de entrada; agregar la tarjeta de prueba `4242 4242 4242 4242`; escanear o escribir un `evseId` (por ejemplo `VOLT-BOG01-CP01-1`) y cargar con el simulador embebido.

Lo que no funciona en Expo Go ni en el navegador: los avisos push (hace falta una compilación de desarrollo con EAS y `extra.eas.projectId` en `app.json`); en el navegador la cámara sí funciona con HTTPS (Chrome en Android usa el detector nativo de códigos; Safari en iOS carga el decodificador WebAssembly de expo-camera); si el sitio no es seguro o el permiso está bloqueado, queda la entrada manual con la explicación. El mapa en el navegador usa Maps JavaScript API con la clave que entrega la API en `GET /v1/config` (`maps.browserKey`, variable `GOOGLE_MAPS_BROWSER_KEY` de la API; en la nube la crea Terraform); sin clave se muestra la lista (iteración 9, ADR 0024).

Rutas públicas de la versión web: `/auth/action` recibe los enlaces de los correos de Identity Platform (verificación, contraseña nueva, restaurar correo, retirar segundo factor) y los aplica con la marca VOLT; las plantillas viven en `infra/identity`. La carpeta `public/` se sirve tal cual en la web (`brand/volt-logo-blanco.png` es el logotipo de esos correos).

## Comprobaciones

```bash
pnpm --filter @volt/mobile typecheck   # tsc con la configuración de Expo
pnpm --filter @volt/mobile test        # módulos puros: formatos, QR, cliente de Wompi, catálogos, estaciones, sesión, actividad
pnpm --filter @volt/mobile export:web  # bundle web con Metro (lo corre CI)
```

El recibo en PDF usa `expo-file-system` y `expo-sharing` (módulo nativo nuevo desde el 30-09-2026): en la web y en Expo Go funciona ya; las compilaciones de EAS anteriores a esa fecha necesitan una nueva (`src/lib/receipt-file.web.ts` descarga el archivo con el token; `receipt-file.native.ts` lo baja a la caché y abre la hoja de compartir).

## Estructura

- `app/`: rutas de Expo Router. `_layout.tsx` carga las fuentes (Barlow Semi Condensed y Roboto), monta los proveedores (identidad, idioma, sesión activa) y las guardas: sin sesión ni modo invitado → `(auth)` (bienvenida, registro, inicio, contraseña); con sesión → `verify-email` y `consents` si hacen falta. `(tabs)` (mapa, actividad, cuenta), `station/[id]`, `evse/[evseId]` y `scan` (modal a pantalla completa) se pueden ver como invitado; `session/[id]`, `receipt/[id]`, medios de pago, cobros, avisos y perfil exigen sesión. El invitado que intenta cargar pasa por registro o inicio y vuelve al mismo cargador (`returnTo`).
- `src/theme`: `tokens.ts` (colores, tipografías, escala, espaciado, radios, tamaños, movimiento y colores por estado de conector, según el handoff de UI/UX y ADR 0025), `icon.tsx` (Material Icons) y `ui.tsx` (pantalla, barra superior, botones, campos, chips, tarjetas, insignias, avisos, filas de datos, mosaicos). `src/components`: barra de pestañas (`tab-bar.tsx`), hoja inferior, anillo de progreso, lista de pasos, diálogo, insignia de conector, marcador del mapa, esqueletos de carga y el mapa (`site-map.native.tsx` con react-native-maps y estilo oscuro; `site-map.web.tsx` con Maps JavaScript API).
- `src/api`: tipos de `/v1`, cliente y consultas con sondeo. `src/auth`: Identity Platform (SDK de Firebase con persistencia en AsyncStorage), estado de la cuenta y modo invitado. `src/session`: sesión de carga activa compartida (botón Cargar y guardas). `src/lib`: formatos de marca, lectura del QR, tokenización en Wompi, avisos push, ubicación del usuario (`expo-location`), nombres y filtros de estaciones, fase y progreso de la sesión, actividad por mes. `src/i18n`: catálogos es/en, fuente de verdad de los textos de la app.
- `assets/`: iconos y logotipo generados desde `docs/marca/volt-logo-blanco.svg`.
- No hay `babel.config.js` a propósito: Expo aplica su preset por defecto (`babel-preset-expo`) resuelto desde sus propios paquetes. Con el `node_modules` aislado de pnpm, un `babel.config.js` que nombre el preset hace fallar el empaquetado de Android en EAS (`Cannot find module 'babel-preset-expo'`), aunque en local funcione. Si algún día hace falta configurar Babel, hay que añadir `babel-preset-expo` como dependencia de desarrollo de la app.

## Compilaciones con EAS

Desde GitHub también: Actions → *Compilación de la app (EAS)* → Run workflow (perfil, plataforma y envío opcional a la tienda); necesita el secreto `EXPO_TOKEN` del repositorio.

Si una compilación falla, Actions → *Diagnóstico de compilación (EAS)* → Run workflow con el id del build (o vacío para el último de Android) imprime el estado, el mensaje de error y las líneas relevantes de sus registros (fases elegibles; sin secretos) en el resumen del trabajo, sin entrar a expo.dev.

El proyecto de EAS ya está enlazado (`extra.eas.projectId` en `app.json`, id `6c086f3f-…`) y `eas.json` trae tres perfiles: `development` (cliente de desarrollo, con avisos push), `preview` (APK e IPA internos para Internal testing y TestFlight, contra staging) y `production` (AAB y IPA para las tiendas). Desde `apps/mobile`, con sesión en Expo (`npx eas-cli login`):

```bash
npx eas-cli build --profile development --platform android   # primera vez: EAS crea y guarda el keystore
npx eas-cli build --profile preview --platform all
npx eas-cli credentials                                       # huellas SHA-1 del keystore (clave de Maps)
npx eas-cli submit --profile production --platform android    # Internal testing (cuenta de servicio de Play)
```

Credenciales de las tiendas: nunca en el repositorio ni en el chat; EAS las guarda cifradas y las usa en `eas submit` sin archivos locales.

- Android: `npx eas-cli credentials -p android` → perfil `production` → *Google Service Account* → *Set up a Google Service Account Key for Play Store Submissions* → elegir el JSON descargado de Google Cloud (guardado fuera del repositorio o como `apps/mobile/google-play-service-account.json`, que git ignora). Una vez subido, el archivo local se puede borrar. La cuenta de servicio necesita la API *Google Play Android Developer* habilitada en su proyecto de Google Cloud y, en Play Console → Usuarios y permisos, acceso a la app Volt con permisos de publicación en pistas de prueba.
- iOS: `npx eas-cli credentials -p ios` → *App Store Connect API Key* → subir el `.p8` con su *Key ID* e *Issuer ID*.
- Si una llave llega a quedar en un commit (aunque no se haya publicado), se revoca en Google Cloud o en App Store Connect y se genera otra; borrar el archivo del historial no basta. La clave de Google Maps para Android se inyecta en tiempo de compilación con la variable `GOOGLE_MAPS_ANDROID_API_KEY` del ambiente de EAS de cada perfil (`environment` en `eas.json`). La crea y restringe el flujo *Clave de Google Maps (Android)* de GitHub Actions (paquete `co.supercargadores.volt`, huellas SHA-1 del keystore de EAS y de la firma de Google Play, solo Maps SDK for Android) y la guarda en EAS como variable sensible; nunca se escribe en el repositorio.
