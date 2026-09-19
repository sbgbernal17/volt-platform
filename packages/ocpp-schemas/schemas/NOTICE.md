# Origen de los esquemas

Los archivos de `v16/` son los esquemas JSON de OCPP 1.6 publicados por la Open Charge Alliance con la especificación OCPP-J 1.6 y con el OCPP 1.6 Security Whitepaper (mensajes `CertificateSigned`, `DeleteCertificate`, `ExtendedTriggerMessage`, `GetInstalledCertificateIds`, `GetLog`, `InstallCertificate`, `LogStatusNotification`, `SecurityEventNotification`, `SignCertificate`, `SignedFirmwareStatusNotification`, `SignedUpdateFirmware`), tal como los redistribuye el proyecto `mobilityhouse/ocpp` (licencia MIT) en `ocpp/v16/schemas`. No se han modificado.

Cada acción tiene dos archivos: `<Accion>.json` (request) y `<Accion>Response.json` (response). Los mensajes del perfil Core y de los feature profiles usan JSON Schema draft-04; los del Security Whitepaper usan draft-06. Todos declaran `additionalProperties: false` en la raíz.
