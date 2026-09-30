# 0031. Celular verificado por SMS, obligatorio para pagar y cargar

Fecha: 2026-09-30. Estado: aceptada.

## Contexto

El dueño pidió que la app le pida al cliente validar su número de celular y que sea obligatorio. Hasta ahora el celular era un campo libre del perfil (sin comprobar) y la única verificación de identidad era la del correo (ADR 0022). Un celular verificado sirve para contactar al conductor durante una carga (cargador con falla, cobro rechazado), para reducir cuentas falsas y, más adelante, para Nequi y avisos por WhatsApp o SMS.

Identity Platform ofrece autenticación por teléfono, pero desde una app Expo sin el SDK nativo de Firebase exige reCAPTCHA en la web y verificación de app (Play Integrity, APNs) en los teléfonos, un flujo frágil para un piloto. Un código propio por SMS es más simple, funciona igual en la web, en Expo Go y en las compilaciones, y no ata la plataforma a un proveedor.

## Decisión

1. **Código de un solo uso por SMS gestionado por la plataforma.** `POST /v1/me/phone/send-code` normaliza el número a E.164 (Colombia por defecto: 10 dígitos que empiezan por 3; otros países con `+` e indicativo), guarda solo el hash del código (SHA-256 con sal) en `auth.driver_phone_code` y lo envía; `POST /v1/me/phone/verify` lo comprueba y marca `auth.driver.phone_verified_at`. Vigencia de 10 minutos, 5 intentos por código, 60 segundos entre envíos y 5 envíos por día por conductor y por número.
2. **Obligatorio antes de pagar o cargar** (parámetro `auth.driver_require_verified_phone`, `true` por defecto): `assertDriverReady` responde `PHONE_NOT_VERIFIED` después del correo y de los consentimientos (el número es un dato personal y se pide una vez aceptada la autorización de datos). La app lo exige en ese mismo orden con una pantalla propia; en Cuenta y en Perfil se ve el estado y se cambia el número (siempre con un código nuevo).
3. **Un celular verificado pertenece a una sola cuenta activa** (índice único parcial). Cambiar el número a mano desde `PATCH /v1/me` lo deja sin verificar. Al eliminar la cuenta se borran número, marca y códigos.
4. **Puerto `SmsSender`** en `@volt/csms` con emulador (`fake`: el código vuelve en la respuesta y la app lo muestra; solo ambientes de prueba, prohibido en producción) y adaptadores en la API para **Twilio** (Programmable Messaging; número o Messaging Service) y **Brevo** (SMS transaccional; mismo proveedor que puede enviar los correos del ADR 0032). El proveedor y el remitente se eligen por variables (`SMS_PROVIDER`, `SMS_SENDER`, `TWILIO_ACCOUNT_SID`); la clave vive en Secret Manager (`sms-provider-api-key`). En producción es obligatorio un proveedor real.
5. Los textos del SMS van en español o inglés según el idioma del conductor ("VOLT: su código de verificación es 123456. Vence en 10 minutos.").

## Alternativas consideradas

- Autenticación por teléfono de Identity Platform: cubre el envío y la verificación, pero exige reCAPTCHA en la web y atestación de app en los teléfonos desde Expo; se descarta para el piloto.
- Twilio Verify (código gestionado por Twilio): menos código propio, pero ata a un proveedor y el límite de reenvíos e intentos quedaría fuera de la plataforma.
- Pedir el celular solo en el registro sin verificarlo: no responde a lo pedido (validar el número).

## Consecuencias

- Migración 0013: `auth.driver.phone_verified_at`, tabla `auth.driver_phone_code`, índice único parcial y parámetro nuevo.
- dev y staging usan el emulador hasta que el dueño elija proveedor y cargue la clave (tarea del dueño); con el emulador el código aparece en la app y en el log de la API.
- Los SMS a Colombia con remitente alfanumérico no siempre se entregan: con Twilio conviene un número o un Messaging Service; con Brevo, comprobar la cobertura en Colombia antes de producción.
- Las cuentas ya creadas verán la pantalla del celular la próxima vez que entren.
