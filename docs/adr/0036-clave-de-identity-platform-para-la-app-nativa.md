# 0036. Clave de Identity Platform para la app nativa: restringida por API, no por referer

Fecha: 2026-10-01. Estado: propuesta, pendiente del visto bueno del dueño (el cambio de Terraform se aplica cuando lo apruebe).

## Contexto

La app Volt (web, iOS y Android) y el back-office inician sesión contra Identity Platform con el SDK de Firebase y una clave de API pública que la API entrega en `GET /v1/config` (ADR 0022). ADR 0023 creó esa clave con dos restricciones: solo las API de Identity Toolkit y Secure Token, y **referers HTTP** limitados a `admin.`, `app.` y `localhost`. El primer probador de la compilación de iOS en TestFlight (01-10-2026) no pudo entrar: "No se pudo completar. Intente de nuevo". Causa: una app nativa no envía la cabecera `Referer`, y Google responde `403 Requests from referer <empty> are blocked`; el SDK lo convierte en `auth/internal-error` y la app muestra el texto genérico. El mismo bloqueo afecta a Android. La app web no lo sufre porque el navegador sí envía el referer.

## Decisión

1. **La clave de Identity Platform pasa a restringirse solo por API** (`identitytoolkit.googleapis.com` y `securetoken.googleapis.com`), sin restricción de referer. Se cambia la restricción del recurso existente (`identity-platform-browser`) en lugar de crear otra clave, para no regenerar el valor ni redesplegar la API: el cambio surte efecto al aplicar Terraform y la app en TestFlight funciona sin nueva compilación.
2. **Por qué es aceptable**: la clave viaja en la app y en el navegador, es un identificador público por diseño (Google y Firebase lo documentan así) y la restricción de referer no protege contra clientes que no son navegadores. Las defensas reales están en Identity Platform: contraseñas con política, límites de intentos, protección contra enumeración de correos, correo verificado y celular verificado (ADR 0031), y en que la API valida el ID token con las claves públicas del proyecto.
3. **Endurecimiento previsto para producción**: Firebase App Check (DeviceCheck/App Attest en iOS, Play Integrity en Android, reCAPTCHA Enterprise en la web) para que solo nuestras apps usen la clave. Queda en la deuda de ADR 0023.
4. La clave de **Google Maps para el navegador** sigue restringida por referer: solo la usan el back-office y la app web; la app nativa usa su propia clave de Android (variable de entorno sensible en EAS).
5. La *Comprobación de la API* verifica en cada ambiente que la clave de `/v1/config` acepta una petición sin referer (`recaptchaParams` de Identity Toolkit), para que esta regresión no vuelva sin que se note.

## Alternativas consideradas

- **Segunda clave solo para la app nativa**, restringida por identificador de paquete (iOS: `X-Ios-Bundle-Identifier`; Android: `X-Android-Package` y `X-Android-Cert`). El SDK de Firebase para JavaScript que usa Expo no envía esas cabeceras (las envían los SDK nativos), así que la restricción bloquearía igual; habría que interceptar `fetch` en la app, frágil y poco claro.
- **Enviar un `Referer` falso desde la app**: funciona en React Native, pero simula ser un navegador para esquivar una restricción que no aporta seguridad; peor que quitarla.
- **Clave nueva con otro nombre**: regenera el valor, obliga a nueva revisión de la API y a actualizar la salida de Terraform; sin beneficio frente a cambiar la restricción.

## Consecuencias

- Al aprobarse, Terraform quita `browser_key_restrictions` del recurso `google_apikeys_key.identity_platform` en dev y staging (prod la hereda); la salida `identity_platform_api_key` no cambia. Alternativa manual equivalente: Consola → APIs y servicios → Credenciales → clave "Identity Platform (navegador)" → Restricciones de aplicaciones → Ninguna.
- `docs/tareas-del-dueno.md` registra la prueba: entrar en la app de TestFlight y de Pruebas internas sin nueva compilación.
- App Check se añade a la lista de endurecimiento antes de producción (SEG §6).
