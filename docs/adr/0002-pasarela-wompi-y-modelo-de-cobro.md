# 0002. Pasarela de pago Wompi y modelo de cobro con tarjeta tokenizada

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

El sistema opera en Colombia (ADR 0001). El dueño del proyecto decidió trabajar con Wompi (Bancolombia) usando tokenización: el conductor registra una tarjeta en su cuenta, el cobro se hace al final de la carga contra esa tarjeta, y antes de iniciar una carga la plataforma debe validar que la cuenta tiene una tarjeta válida vinculada. No habrá operación previa que migrar: todo el cobro será digital desde el inicio.

Wompi ofrece fuentes de pago tokenizadas (tarjetas y cuentas Nequi) que permiten cobrar después sin intervención del cliente, exige una autenticación inicial 3D Secure para habilitar cobros recurrentes con tarjeta, requiere los tokens de aceptación de términos y de tratamiento de datos, entrega eventos por webhook firmados con un checksum SHA-256 calculado con el secreto de eventos, y dispone de ambiente sandbox con llaves `pub_test_` / `prv_test_`. No se confirmó soporte de preautorización con captura posterior, por lo que el diseño no depende de retener fondos.

## Decisión

1. **Wompi es la pasarela** y se integra detrás del puerto `PaymentGateway` del dominio (ARQ §2.1), de modo que el resto del sistema no conoce la API concreta.
2. **Alta de la tarjeta en la app Volt:** tokenización con el widget o SDK de Wompi (los datos de tarjeta nunca pasan por nuestros servidores, objetivo PCI DSS SAQ A), aceptación de términos y de tratamiento de datos, autenticación 3D Secure inicial y creación de la fuente de pago. Se guarda solo el identificador de la fuente de pago, la marca, los últimos cuatro dígitos y la fecha de vencimiento. Nequi como fuente de pago queda como opción posterior.
3. **Validación antes de iniciar la carga** (`POST /v1/sessions`): la cuenta tiene una fuente de pago activa y no vencida, no tiene deuda pendiente, no está bloqueada, y el límite de exposición vigente es mayor que cero. Si falla, la app muestra la causa y ofrece registrar o actualizar la tarjeta.
4. **Límite de exposición por sesión en lugar de preautorización:** como no se retienen fondos, el riesgo de impago se acota con un tope por sesión configurable por tenant y por segmento (por ejemplo, un tope reducido para la primera carga de una cuenta nueva y un tope estándar después). El motor de tarifas calcula el costo en tiempo real con los `MeterValues` y, al alcanzar el tope, la plataforma envía `RemoteStopTransaction` una sola vez, con los mismos eventos que ya define TAR §3.3 (`PREAUTH_WARN` al 80 %, `PREAUTH_EXHAUSTED` al 100 %) aplicados al tope en vez de a un hold. El conductor ve el tope y el costo acumulado en la app.
5. **Cobro al cierre de la sesión:** cuando el motor emite el cálculo `FINAL`, el worker crea una transacción en Wompi contra la fuente de pago por el importe final en pesos enteros, con `reference` igual al identificador de la sesión (idempotente: una sola transacción por sesión) y espera el evento `transaction.updated`. Cada evento se verifica con el checksum y el secreto de eventos, se registra en una bandeja de entrada idempotente y actualiza el estado del pago (`APPROVED`, `DECLINED`, `ERROR`, `VOIDED`). El estado de la sesión pasa a `PAID` solo con `APPROVED`.
6. **Cobro rechazado:** reintentos automáticos con calendario (por ejemplo, a las 2, 24 y 72 horas), notificación al conductor, cuenta bloqueada para nuevas cargas mientras exista deuda, y opción de pagar la deuda desde la app mediante un enlace de checkout de Wompi que admite tarjeta, PSE y Nequi. Tras el pago, el bloqueo se levanta automáticamente por el evento del webhook.
7. **Recibos, reembolsos y conciliación:** recibo por sesión en la app y por correo; reembolsos por la vía que Wompi permita para la transacción (anulación o reembolso) y, si no es posible, como nota crédito y ajuste manual auditado; conciliación diaria entre las transacciones de Wompi y las sesiones liquidadas, con alarma por discrepancia.
8. **Secretos y ambientes:** llaves pública y privada, secreto de integridad y secreto de eventos en Secret Manager, distintos por ambiente; sandbox de Wompi en dev y staging; producción solo con llaves `prod`.

## Alternativas consideradas

- Preautorización con captura parcial (PayU con flujo de dos pasos, Mercado Pago con reserva de fondos): reduce el riesgo de impago, pero el dueño del proyecto eligió Wompi y el cobro al final; se compensa con el límite de exposición.
- Wallet prepago recargable por PSE y Nequi: descartado para el MVP; queda como opción de la fase 2 si los rechazos de cobro lo justifican.

## Consecuencias

- El riesgo de crédito existe y se gestiona con el tope por sesión, los topes progresivos por antigüedad de la cuenta y el bloqueo por deuda. La métrica "cobros fallidos" entra en las métricas del MVP.
- Registrar cuenta y tarjeta es requisito para cargar. Debe confirmarse con el asesor legal que exigir registro cumple la Resolución 40123 de 2024 (acceso y pago sin restricciones ni membresía). Si se exige un flujo sin registro, se añadirá en la fase 2 un pago de invitado con checkout de Wompi por un monto fijo y devolución de la diferencia.
- La app debe integrar el widget o SDK de Wompi y el flujo 3D Secure; el back-office necesita pantallas de pagos, deudas, reintentos y conciliación.
- La facturación electrónica DIAN (ADR 0001) se emite al confirmarse el cobro (`APPROVED`), con nota crédito en reembolsos.
