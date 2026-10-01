# 0032. Correos de identidad con envío propio (botón con la marca)

Fecha: 2026-09-30. Estado: aceptada.

## Contexto

El dueño pidió, para los correos de verificación y de contraseña nueva, "en vez de mandar el link en el cuerpo del correo, poner un botón o algo más amigable". Identity Platform no permite cambiar el cuerpo de sus plantillas (la API responde `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED` y la consola tampoco lo deja): solo el remitente, el asunto y la URL de acción, que el dueño ya configuró (tarea 9b). El cuerpo con la marca (logotipo, botón "Confirmar correo", voz de usted) existe desde la iteración 9 en `infra/identity/templates`, pero no había quien lo enviara.

## Decisión

1. **La plataforma genera el enlace y envía el correo.** La API pide a Identity Platform el enlace de acción (`accounts:sendOobCode` con `returnOobLink`) con la identidad de la cuenta de servicio de Cloud Run (token del servidor de metadatos; sin claves) y lo inserta en la plantilla HTML propia. El enlace apunta a la misma página de acción de la app web (`/auth/action`) que ya se usa.
2. **Rutas**: `POST /v1/auth/send-verification` (autenticada; reenvía la verificación al correo de la cuenta) y `POST /v1/auth/password-reset` (pública; nunca revela si el correo existe). Límites en memoria: un envío por minuto y cinco por hora por correo o conductor, veinte por hora por IP.
3. **Puerto `EmailSender`** en `@volt/csms` con emulador (`fake`, pruebas) y adaptadores en la API para **Resend** y **Brevo** (`EMAIL_PROVIDER`, `EMAIL_FROM`, clave en Secret Manager `email-provider-api-key`). El dueño eligió Brevo el 01-10-2026 con el remitente verificado `notificaciones@supercargadores.co` (ADR 0019); dev y staging envían con él desde esa fecha. Las plantillas HTML se convierten en un módulo generado (`infra/identity/build-templates.mjs`) y una prueba comprueba que no se desactualice.
4. **La app decide por la configuración pública** (`GET /v1/config` → `email.custom`): con proveedor, usa las rutas de la API al registrarse, al reenviar la verificación y al olvidar la contraseña; sin proveedor (o si la API falla), el SDK de Firebase envía el correo genérico de Google como hasta ahora.
5. Los cambios de correo y el segundo factor siguen saliendo de Identity Platform (son flujos del personal, poco frecuentes).
6. **Respaldo (adición del 01-10-2026).** Si el proveedor rechaza el envío (clave inválida, IP no autorizada, caída), la API pide a Identity Platform que envíe su correo genérico (`sendOobCode` sin `returnOobLink`; para la verificación con el ID token del conductor) y responde `{ sent: true, fallback: 'identity-platform' }`. La verificación de la cuenta nunca depende de un solo proveedor; el aviso queda en el registro de la API para corregir el proveedor. Motivo: el 01-10-2026 Brevo rechazó todos los envíos de dev con `401 unrecognised IP` porque la cuenta tenía activada la restricción de IP autorizadas, y Cloud Run sale a internet con direcciones variables.

## Alternativas consideradas

- Esperar a que Google permita editar el cuerpo: no depende de nosotros.
- Enviar todos los correos desde el worker a partir del outbox: los de identidad necesitan respuesta inmediata (el conductor está esperando); los recibos y avisos sí irán por el worker con el mismo puerto.
- Un proveedor único distinto (SendGrid, SES): Resend y Brevo tienen API mínima, plan gratuito suficiente para el piloto y, en el caso de Brevo, SMS en la misma cuenta (ADR 0031).

## Consecuencias

- La cuenta de servicio de la API recibe `roles/firebaseauth.admin` (Terraform) para generar enlaces.
- Brevo reescribe los enlaces de los correos transaccionales con su dominio de seguimiento de clics cuando el seguimiento está activo en la cuenta; el enlace sigue llegando a la página de acción (redirige), pero conviene desactivar el seguimiento de clics en Brevo (Transaccional → Configuración) para que el botón apunte directo a `app.supercargadores.co`.
- El cuerpo va solo en español por ahora; la versión en inglés queda para cuando se traduzcan las plantillas.
