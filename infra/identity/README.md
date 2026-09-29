# Correos de Identity Platform con la identidad VOLT

Identity Platform envía por sí mismo los correos de verificación de correo, contraseña nueva, cambio de correo y activación del segundo factor (SDK de Firebase en la app y en el back-office). Desde la iteración 9 (ADR 0024) esas plantillas llevan la marca VOLT y sus enlaces abren una página propia de la app web en lugar de la página genérica de Google.

## Qué hay aquí

- `config.json`: nombre del remitente, asuntos y archivo de cada plantilla, y la ruta de la página de acción (`/auth/action`).
- `templates/*.html`: cuerpos HTML (tema claro del manual de marca, logotipo blanco sobre rojo, botón primario, voz de usted). Marcadores de Identity Platform: `%LINK%` (obligatorio), `%EMAIL%`, `%NEW_EMAIL%`, `%DISPLAY_NAME%`. Marcador propio `{{APP_HOST}}` (host de la app web, de donde se sirve el logotipo `brand/volt-logo-blanco.png`).
- `build-config.mjs`: arma el cuerpo del `PATCH admin/v2/projects/{proyecto}/config` (Identity Toolkit) con `updateMask` y comprueba que ninguna plantilla se quede sin `%LINK%` ni con marcadores sin sustituir. Solo biblioteca estándar de Node.

## Cómo se aplica

Actions → *Correos de identidad (plantillas VOLT)* → Run workflow → ambiente (`dry_run` para ver el estado actual sin cambiar nada). El flujo se autentica con Workload Identity Federation (rol `identityplatform.admin` del desplegador, `infra/terraform/iam.tf`), aplica las plantillas y el `callbackUri`, y añade los hosts de la app y del back-office a los dominios autorizados. No imprime cuerpos ni tokens; deja en el resumen los asuntos y el remitente resultantes.

Para revisar el cuerpo en local:

```bash
node infra/identity/build-config.mjs --app-host app-dev.supercargadores.co | jq '.body.notification.sendEmail | map_values(.subject? // .)'
```

## Página de acción

`apps/mobile/app/auth/action.tsx` (app web, ruta pública `/auth/action?mode=…&oobCode=…`): aplica el código con el SDK de Firebase (`applyActionCode`, `verifyPasswordResetCode` + `confirmPasswordReset`), muestra el resultado con la marca y ofrece volver a la app o al back-office. Sirve para conductores y para el personal, porque ambos viven en el mismo proyecto de Identity Platform.

## Remitente con dominio propio (tarea del dueño)

Mientras no haya dominio verificado, los correos salen de `noreply@<proyecto>.firebaseapp.com` con el nombre "VOLT". Para que salgan de `noreply@supercargadores.co`: Firebase console del proyecto → Authentication → Templates → *Customize domain* → escribir `supercargadores.co` → copiar los registros DNS que muestra (TXT de verificación, SPF y CNAME de DKIM) a la zona de Netlify → esperar la verificación (hasta 48 h). Después, poner `"senderLocalPart": "noreply"` en `config.json` y volver a ejecutar el flujo. Las plantillas y la página de acción no cambian.
