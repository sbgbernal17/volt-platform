# 0032. Correos de identidad con envío propio (botón con la marca)

Fecha: 2026-09-30. Estado: aceptada.

## Contexto

El dueño pidió, para los correos de verificación y de contraseña nueva, "en vez de mandar el link en el cuerpo del correo, poner un botón o algo más amigable". Identity Platform no permite cambiar el cuerpo de sus plantillas (la API responde `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED` y la consola tampoco lo deja): solo el remitente, el asunto y la URL de acción, que el dueño ya configuró (tarea 9b). El cuerpo con la marca (logotipo, botón "Confirmar correo", voz de usted) existe desde la iteración 9 en `infra/identity/templates`, pero no había quien lo enviara.

## Decisión

1. **La plataforma genera el enlace y envía el correo.** La API pide a Identity Platform el enlace de acción (`accounts:sendOobCode` con `returnOobLink`) con la identidad de la cuenta de servicio de Cloud Run (token del servidor de metadatos; sin claves) y lo inserta en la plantilla HTML propia. El enlace apunta a la misma página de acción de la app web (`/auth/action`) que ya se usa.
2. **Rutas**: `POST /v1/auth/send-verification` (autenticada; reenvía la verificación al correo de la cuenta) y `POST /v1/auth/password-reset` (pública; nunca revela si el correo existe). Límites en memoria: un envío por minuto y cinco por hora por correo o conductor, veinte por hora por IP.
3. **Puerto `EmailSender`** en `@volt/csms` con emulador (`fake`, pruebas) y adaptadores en la API para **Resend** y **Brevo** (`EMAIL_PROVIDER`, `EMAIL_FROM`, clave en Secret Manager `email-provider-api-key`). Las plantillas HTML se convierten en un módulo generado (`infra/identity/build-templates.mjs`) y una prueba comprueba que no se desactualice.
4. **La app decide por la configuración pública** (`GET /v1/config` → `email.custom`): con proveedor, usa las rutas de la API al registrarse, al reenviar la verificación y al olvidar la contraseña; sin proveedor (o si la API falla), el SDK de Firebase envía el correo genérico de Google como hasta ahora.
5. Los cambios de correo y el segundo factor siguen saliendo de Identity Platform (son flujos del personal, poco frecuentes).

## Alternativas consideradas

- Esperar a que Google permita editar el cuerpo: no depende de nosotros.
- Enviar todos los correos desde el worker a partir del outbox: los de identidad necesitan respuesta inmediata (el conductor está esperando); los recibos y avisos sí irán por el worker con el mismo puerto.
- Un proveedor único distinto (SendGrid, SES): Resend y Brevo tienen API mínima, plan gratuito suficiente para el piloto y, en el caso de Brevo, SMS en la misma cuenta (ADR 0031).

## Consecuencias

- La cuenta de servicio de la API recibe `roles/firebaseauth.admin` (Terraform) para generar enlaces.
- dev y staging siguen con `EMAIL_PROVIDER=none` hasta que el dueño cargue la clave del proveedor elegido; entonces se cambia la variable de Terraform y se despliega, sin tocar la app.
- El cuerpo va solo en español por ahora; la versión en inglés queda para cuando se traduzcan las plantillas.
