# 0027. Documento de identidad y factura electrónica en el perfil del conductor

Fecha: 2026-09-30. Estado: aceptada.

## Contexto

La factura electrónica ante la DIAN (iteración 10) necesita identificar al adquiriente: tipo y número de documento, nombre y correo. El dueño pidió que el documento no sea obligatorio como el correo, pero que sí lo sea cuando la persona marque que requiere factura electrónica. Hasta ahora el perfil solo tenía nombre, correo y teléfono, y el recibo congelaba `{email, name, phone}` en `billing.invoice.buyer_snapshot`.

## Decisión

1. `auth.driver` gana `document_type` (CC, CE, NIT, PAS, PPT), `document_number` y `wants_invoice` (migración 0011). Restricciones en la base: tipo y número van juntos, y `wants_invoice` exige documento.
2. La regla condicional se aplica en el CSMS sobre el estado resultante (`resolveDriverDocument`), porque el `PATCH /v1/me` es parcial: no basta con validar el cuerpo. Los códigos de error son `INVOICE_DOCUMENT_REQUIRED` y `DOCUMENT_INVALID`, y la app los traduce.
3. El número se normaliza (sin puntos ni espacios, mayúsculas) y se valida por tipo; el NIT se guarda con su dígito de verificación y se comprueba con el algoritmo de la DIAN.
4. El recibo congela también `documentType`, `documentNumber` y `wantsInvoice` en `buyer_snapshot`, base legal del adquiriente para la factura de la iteración 10. Como ya ocurría con nombre y correo, el snapshot sobrevive al borrado de la cuenta (base legal tributaria, DAT §5); el perfil vivo sí se anonimiza (documento a NULL y factura apagada).
5. Protección del dato: el número se enmascara en la lista de conductores del back-office (`···1234`) y se muestra completo solo en el detalle; la auditoría de administración lo redacta (`document` entra en la lista de claves sensibles). El cifrado a nivel de aplicación que pide SEG §5 (Tink con KMS) queda como deuda junto con CMEK (ADR 0023): hoy Cloud SQL cifra en reposo y el dato no viaja a registros ni eventos.
6. En la app, el documento vive en Perfil con el interruptor "Requiere factura electrónica"; el registro no lo pide. Para NIT, el nombre del perfil hace de razón social hasta que la iteración 10 defina los campos del adquiriente jurídico (dirección, responsabilidades fiscales) con el proveedor tecnológico.

## Alternativas consideradas

- Pedir el documento a todos en el registro: más fricción y datos personales sin necesidad (Ley 1581, minimización).
- Validar solo en zod: se pierde el caso "borrar el documento con la factura activa" y el de "activar la factura sin documento en un PATCH parcial".
- Cifrar ya con KMS: exige claves por ambiente y una dependencia nueva; se decide junto con CMEK antes de producción.

## Consecuencias

- Cambio de contrato compatible: los campos nuevos son opcionales en el `PATCH` y siempre presentes en el `GET`.
- La iteración 10 parte de `buyer_snapshot` con documento; falta decidir con el contador y el proveedor la numeración y los campos del adquiriente jurídico.
- Pendiente del dueño: confirmar con el contador si PPT y pasaporte bastan como documentos del adquiriente para el documento equivalente.
