> Entregado por el dueño del proyecto el 22 de septiembre de 2026 (respuesta al punto 5 de "Pendiente ahora" en `docs/tareas-del-dueno.md`). Sin datos sensibles: los identificadores que aparecen son ejemplos de la documentación de Wompi. Las preguntas abiertas de la sección 6 se formulan por escrito al ejecutivo comercial antes de salir a producción (iteración 5).

# Wompi Colombia — Tokenización, 3DS, cobros recurrentes, anulaciones y comisiones

> Consolidado desde la documentación oficial de Wompi Colombia, la referencia del API (OpenAPI 1.2.0) y los artículos del centro de soporte.
> Fecha de consulta: 22 de septiembre de 2026.

---

## Índice

1. [Tokenización con 3D Secure](#1-tokenización-con-3d-secure)
2. [Cobros posteriores sin presencia del cliente](#2-cobros-posteriores-sin-presencia-del-cliente)
3. [Anulaciones y reembolsos](#3-anulaciones-y-reembolsos)
4. [Tokenización de Nequi (y otros medios)](#4-tokenización-de-nequi-y-otros-medios)
5. [Comisiones y tarifas](#5-comisiones-y-tarifas)
6. [Consideraciones para un caso de cobro por consumo variable](#6-consideraciones-para-un-caso-de-cobro-por-consumo-variable)
7. [Fuentes](#7-fuentes)

---

## 1. Tokenización con 3D Secure

Wompi maneja **dos niveles** de fuente de pago con tarjeta:

| Tipo | Descripción |
|---|---|
| Fuente de pago simple | Sin 3DS. Cobros posteriores sin autenticación del titular. |
| **Fuente de pago segura con 3DS** | Habilita cobros automáticos autenticados bajo protocolo **3RI** (3D Secure 2.2 Requestor Initiated). |

### 1.1 Flujo de tres pasos

**Paso 1 — Tokenizar la tarjeta**

`POST /v1/tokens/cards` con **llave pública**.

Wompi recomienda por defecto **tokenizar cifrando** la información:

1. Obtener la llave pública de tokenización: `GET /v1/tokens/keys/tokenization`
2. Generar un JWE con algoritmo **RSA-OAEP-256** y CEK **AES-GCM-256**
3. Enviar el JWE como string en el campo `payload` a `POST /v1/tokens/cards`

Alternativas:

- **Tokenización simple** (sin cifrado), si el caso de uso no soporta JWE.
- **Widget en modo tokenización** — los campos los pinta Wompi dentro de su iframe, el número de tarjeta nunca toca tu código:

```html
<form method="POST" action="/process_token">
  <script
    src="https://checkout.wompi.co/widget.js"
    data-render="button"
    data-widget-operation="tokenize"
    data-public-key="pub_test_XXXXXXXX"
  ></script>
</form>
```

> **Nunca guardes información sensible de tarjetas.** Wompi cuenta con certificación PCI DSS; el comercio solo debe manejar los tokens.

**Paso 2 — Crear la fuente de pago**

`POST /v1/payment_sources` con **llave privada, desde el backend**. Nunca desde el navegador o la app.

```json
{
  "type": "CARD",
  "token": "tok_prod_1_BBb749EAB32e97a2D058Dd538a608301",
  "customer_email": "cliente@ejemplo.com",
  "acceptance_token": "<token de política de privacidad>",
  "accept_personal_auth": "<token de autorización de tratamiento de datos>"
}
```

Los **dos tokens de aceptación son obligatorios**:

- `acceptance_token` → política de privacidad / reglamento de usuarios.
- `accept_personal_auth` → autorización de tratamiento de datos personales (Ley 1581).

Respuesta esperada:

```json
{
  "data": {
    "id": 3891,
    "public_data": { "type": "CARD" },
    "type": "CARD",
    "status": "AVAILABLE"
  }
}
```

**Paso 3 — Cobrar** (ver sección 2).

### 1.2 Flujo 3DS sobre la fuente de pago

Al crear la fuente con 3DS activado, queda en `status: PENDING` y aparece `extra.is_three_ds: true`.

Debes hacer **polling a `GET /v1/payment_sources/{payment_source_id}` cada 2 segundos** y leer el objeto `extra.three_ds_auth`.

**Pasos, en orden:**

| Paso | `current_step` | ¿Requiere al titular? |
|---|---|---|
| 1 | `BROWSER_INFO` | No — se ejecuta solo al renderizar |
| 2 | `FINGERPRINT` | No — se ejecuta solo al renderizar |
| 3 | `CHALLENGE` | **Sí** — OTP, clave dinámica, biometría (lo define el banco emisor) |
| 4 | `AUTHENTICATION` | No — resultado final |

Cada paso tiene `current_step_status`: `PENDING`, `ERROR` o `COMPLETED`.

**Campo `three_ds_method_data`:** contiene HTML que debes renderizar. Viene **escapado** (con `&lt;`, `&gt;` en vez de `<`, `>`), así que hay que des-escaparlo antes de inyectarlo.

**Estado final de la fuente de pago:** `AVAILABLE`, `DECLINED` o `ERROR`.

### 1.3 Escenarios de falla

| Escenario | Resultado |
|---|---|
| El usuario abandona el challenge | Wompi tiene un tiempo límite para todo el flujo. Al excederlo: fuente en `ERROR` y `current_step_status: ABANDONED`. No hay que hacer nada. |
| El BIN de la tarjeta no soporta 3DS | La validación ocurre **antes** de Browser Info. La fuente queda `DECLINED` de inmediato y el flujo termina. |

### 1.4 Restricciones clave

- **Requiere activación:** hay que solicitar al **equipo de gestión de fraude de Wompi** la habilitación de 3DS en fuentes de pago. No viene activo por defecto.
- **3DS para crear fuentes de pago:** disponible en **Visa y Mastercard**.
- **3RI (cobro automático autenticado):** disponible **únicamente en Mastercard**.
- La disponibilidad por franquicia **varía según el modelo del comercio** (Gateway o Agregador).
- Existe ambiente **Sandbox** para probar todo el flujo antes de solicitar activación en producción. Tarjeta de prueba recomendada: `4242 4242 4242 4242` (admite múltiples tipos de autenticación 3DS).

---

## 2. Cobros posteriores sin presencia del cliente

Se usa **el mismo endpoint de las transacciones normales**, `POST /v1/transactions`, pero con **llave privada** y enviando `payment_source_id`.

```json
{
  "amount_in_cents": 4990000,
  "currency": "COP",
  "signature": "<firma de integridad>",
  "customer_email": "cliente@ejemplo.com",
  "reference": "<referencia única>",
  "payment_source_id": 3891,
  "payment_method": {
    "installments": 2
  }
}
```

- `payment_method` **solo se envía si la fuente de pago es una tarjeta** (para indicar el número de cuotas). Con Nequi, DaviPlata o Bancolombia se omite.
- `payment_source_id` es obligatorio en todos los casos.
- Si la fuente se creó con 3DS, **estos cobros quedan automáticamente protegidos bajo 3RI**, sin interacción del cliente.

### 2.1 Credential on File (COF)

Aumenta la tasa de aprobación. Se activa enviando el booleano `recurrent`:

| Valor | Significado |
|---|---|
| `true` | Cobros del **mismo monto, de manera periódica** (transacción de venta COF con recurrencia). Ej.: suscripción mensual. |
| `false` | Cobros de **montos diferentes, sin ninguna periodicidad** (transacción de venta COF almacenada). Ej.: consumo variable, servicio on-demand. |

```json
{
  "amount_in_cents": 4990000,
  "currency": "COP",
  "customer_email": "cliente@ejemplo.com",
  "payment_method": { "installments": 2 },
  "reference": "<referencia única>",
  "payment_source_id": 3891,
  "recurrent": true
}
```

**Condiciones para que COF aplique realmente:**

- Franquicia **Visa o Mastercard**.
- Procesador de pagos **RBM**.
- Con `recurrent`, el campo `payment_source_id` pasa a ser **obligatorio**.

> Si no se envía `recurrent`, o la franquicia no es Visa/Mastercard, o el procesador no es RBM, **la transacción se procesa igual pero sin COF** — de forma silenciosa, sin error.

### 2.2 Notas operativas

- **La consulta de transacciones desde el frontend ya no está soportada.** Solo con llave privada desde el servidor (`GET /v1/transactions/{id}`); con llave pública devuelve `404`.
- Configurar **webhooks** en el Dashboard de Wompi para recibir el evento `transaction.updated`.
- Usar **referencias únicas** por transacción (recomendado: número de pedido + timestamp).
- **Capturar y almacenar la IP** del dispositivo de origen, en el backend, para trazabilidad y reglas antifraude. Si hay proxy o balanceador, verificar `X-Forwarded-For`.
- La llave privada **nunca** debe salir del servidor.

### 2.3 Estados de una transacción

| Estado | Descripción |
|---|---|
| `PENDING` | Creada, en procesamiento. Toda transacción nueva nace así. |
| `APPROVED` | Aprobada, pago completado. |
| `DECLINED` | Rechazada (fondos insuficientes, datos inválidos, etc.). |
| `VOIDED` | **Anulada — solo aplica a tarjetas.** |
| `ERROR` | Error durante el procesamiento. |

---

## 3. Anulaciones y reembolsos

### 3.1 Anulación (void)

```
POST /v1/transactions/{transaction_id}/void
Authorization: Bearer prv_prod_xxxxx
```

Cuerpo opcional: `{ "amount_in_cents": 3000000 }`

**Reglas:**

- Anula una transacción **APROBADA**.
- **Aplica únicamente a transacciones con tarjeta (`CARD`).** No existe anulación para Nequi ni QR.
- Estado resultante: `VOIDED`.
- **Debe hacerse el mismo día y de manera inmediata** después del pago, para que quede en línea.
- **Depende de la red.** Una transacción puede aprobarse en segundos y, una vez aprobada, la red puede ya no permitir su anulación.
- **Ventaja contable:** al anular, la liquidación no se hace efectiva — no se liquidan impuestos ni comisión.

**Si la red no permite anular:** se solicita una **reversión** a través del formulario de soporte de Wompi o WhatsApp, enviando:

- Código de autorización
- Fecha de la transacción
- Últimos dígitos de la tarjeta
- Valor de la transacción

Tiempo de respuesta estipulado: **máximo 10 días hábiles**. La solicitud **puede ser rechazada por la red si la transacción ya está contracargada**.

### 3.2 Reembolso

Hay **dos versiones vivas** del API:

**V2 (la nueva) — `POST /v1/refunds`**

- **Exige estrictamente llave privada** (`prv_*`) como Bearer token. Con llave pública responde `401 Unauthorized` / `403 Forbidden`.
- Soporta reembolsos **totales o parciales**.
- Hasta **5 referencias personalizadas**.
- Disponible en **Colombia (COP)** y **Panamá (USD)**.

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `transaction_id` | string | Sí | ID de la transacción aprobada a reembolsar |
| `amount_in_cents` | integer | Sí | Monto total o parcial, en centavos |
| `reason` | string | No | Motivo del reembolso |
| `reference` … `reference_5` | string | No | Referencias personalizadas (máx. 5) |

```bash
curl -i -X POST https://sandbox.wompi.co/v1/refunds \
  -H "Authorization: Bearer prv_test_XXXXXXXXXXXXXXXX" \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "1688-1788842576-38603",
    "amount_in_cents": 150000,
    "reason": "Solicitud del cliente",
    "reference": "REF_001"
  }'
```

Respuesta exitosa (`201 Created`): incluye `status`, `v2_refund_id`, `amount_in_cents` y las referencias.

**Escenarios de prueba en Sandbox** (campo `test_scenario`):

| Escenario | Estado esperado | HTTP |
|---|---|---|
| `approved` | `APPROVED`, asigna `v2_refund_id` | 201 |
| `declined` | `DECLINED` — "Tiempo límite sin encontrar fondos excedido" | 201 |
| `error` | `ERROR` — "Error en la comunicación con el autorizador" | 201 |
| `cancelled` | `CANCELLED`, con `cancelled_at` | 201 |
| Más de 5 referencias | `INPUT_VALIDATION_ERROR` | 422 |

**V1 (la anterior) — `POST /v1/transactions/{id}/refunds`**

No procesa los atributos extendidos de referencias ni interactúa con la lógica del Sandbox V2.

### 3.3 Reglas de negocio del reembolso

- La compra **debió ser liquidada y desembolsada previamente**.
- Los impuestos **son devueltos al cliente comprador**.
- **La comisión de Wompi y el IVA sobre esa comisión NO se devuelven**, porque el reembolso es una transacción independiente de la compra inicial.
- El comercio **debe tener saldo en "Disponible"** en su cuenta Wompi para que el reembolso se procese.
- Reembolsos **parciales**: solo para tarjetas **VISA, MASTERCARD y AMEX** con autorizador **Redeban/Credibanco**.
- Para los autorizadores **RBM, API Nequi y Botón Bancolombia solo se permiten reembolsos totales**.

### 3.4 Punto abierto: plazo máximo

> **Wompi no publica un plazo máximo en días para solicitar un reembolso.** Ni la documentación técnica ni los artículos del centro de soporte lo especifican. El plazo depende de la red y del modelo de afiliación (Agregador vs. Gateway).
>
> **Acción recomendada:** solicitarlo por escrito al ejecutivo comercial o a soporte antes de definir una política de devoluciones de cara al cliente.

---

## 4. Tokenización de Nequi (y otros medios)

### 4.1 Nequi — sí se puede tokenizar

Nequi **no usa 3DS** (3DS es un protocolo de franquicias de tarjeta). La autorización se da mediante la suscripción que el cliente acepta en su app.

**Flujo:**

1. `POST /v1/tokens/nequi` con **llave pública**:
   ```json
   { "phone_number": "3017654321" }
   ```
   Devuelve un `id` (el token) en estado `PENDING`.

2. **El cliente acepta la suscripción en su app Nequi.**

3. Polling: `GET /v1/tokens/nequi/{token_id}` hasta que `status` sea `APPROVED`.
   ```json
   {
     "data": {
       "id": "nequi_prod_RQkUiuv3lEnDLiSao2Cz0iQLdFlyQOI5",
       "status": "APPROVED",
       "phone_number": "3107654321",
       "name": "Company Name"
     }
   }
   ```

4. `POST /v1/payment_sources` con **llave privada**:
   ```json
   {
     "type": "NEQUI",
     "token": "nequi_prod_RQkUiuv3lEnDLiSao2Cz0iQLdFlyQOI5",
     "customer_email": "cliente@ejemplo.com",
     "acceptance_token": "<...>",
     "accept_personal_auth": "<...>"
   }
   ```
   → `status: AVAILABLE`

5. Cobrar con `payment_source_id`, **sin** objeto `payment_method`.

**Limitaciones de Nequi frente a tarjeta:**

- **No hay anulación (void)** — el void es exclusivo de `CARD`.
- **Los reembolsos solo pueden ser totales.**

### 4.2 DaviPlata

- Requiere **activación previa con el equipo comercial** de Wompi.
- `POST /v1/tokens/daviplata` con `type_document`, `number_document`, `product_number`.
- Flujo con **OTP**: envío (`code_otp_send`) y validación (`code_otp_validate`). El OTP tiene vigencia de ~3 minutos.
- Límites en producción: **máximo 2 reenvíos** de OTP y **máximo 2 intentos** de validación. Al excederlos, el token queda `DECLINED`.
- **Un cliente solo puede tokenizar su DaviPlata una vez** por comercio (error `SUSCRIPCION_YA_EXISTE`).
- Desuscripción: `PUT /v1/payment_sources/{id}/void` → la fuente queda en `VOIDED`.

### 4.3 Cuentas Bancolombia (Botón Bancolombia)

- `POST /v1/tokens/bancolombia_transfer` con `redirect_url` y `type_auth`:
  - `TOKEN` → el cliente selecciona y autoriza la cuenta **antes** de la transacción, vía `authorization_url`. El token nace `PENDING` y pasa a `APPROVED`.
  - `TRANSACTION` → la autorización se ejecuta en la primera transacción. El token nace `AVAILABLE`.
- Luego `POST /v1/payment_sources` con `type: "BANCOLOMBIA_TRANSFER"` y un `payment_description` (descripción por defecto de cada cobro, personalizable por transacción).

### 4.4 Resumen comparativo

| Medio | Tokenizable | 3DS | Anulación (void) | Reembolso |
|---|---|---|---|---|
| Tarjeta (Visa/MC) | Sí | Sí (3RI solo MC) | Sí, mismo día | Total y parcial |
| Tarjeta Amex | Sí | No | Sí, mismo día | Total y parcial (Redeban/Credibanco) |
| Nequi | Sí | No aplica | No | Solo total |
| DaviPlata | Sí (activación previa) | No aplica | No (solo desuscripción) | — |
| Bancolombia | Sí | No aplica | No | Solo total |

---

## 5. Comisiones y tarifas

### 5.1 Planes (Colombia)

| Plan | Tarifa por transacción exitosa |
|---|---|
| **Plan Avanzado (Agregador)** | **2,65% + $700 + IVA**, igual para todos los medios de pago. Código QR al **1%**. Tarjetas internacionales sin costo adicional. |
| **Plan Avanzado con Puntos Colombia** | 2,65% + $700 + IVA **+ 1,44% de la venta** cuando el cliente gane Puntos Colombia pagando con tarjeta débito, crédito o PSE. Código QR al 1%. |
| **Plan Gateway** | **Wompi no cobra comisión.** Solo se paga la tarifa negociada con Bancolombia para cada medio de pago. Diseñado para comercios con **más de 2.000 transacciones** que ya tienen medios de aceptación contratados con Bancolombia. |

**Desembolso:** en el plan Agregador, el dinero se recibe **al siguiente día hábil** de la venta, en cuenta Bancolombia (ahorros o corriente) o Nequi.

**Medios incluidos en el Plan Avanzado Agregador:** Visa, Mastercard, Amex, Botón Bancolombia, Código QR, Nequi, Compra y Paga Después, Corresponsales, PSE, DaviPlata, SU+Pay.

### 5.2 Retenciones (modelo Agregador)

Cuando el medio de pago es **tarjeta**, además de la comisión Wompi se aplican:

| Concepto | Tarifa |
|---|---|
| Retención en la fuente | 1,5% |
| Retención de ICA | 0,2% |
| Retención de IVA | 15% |

Con **otros medios de pago** solo se cobra la comisión de Wompi.

### 5.3 Efecto de anulaciones y reembolsos sobre la comisión

| Operación | Efecto |
|---|---|
| **Anulación** | La liquidación **no se hace efectiva** — no se liquidan impuestos ni comisión. |
| **Reembolso total** | Los impuestos se devuelven, **pero la comisión de Wompi y el IVA sobre la comisión no se reintegran**. |

### 5.4 Requisitos de vinculación

- Cuenta Bancolombia (ahorros o corriente) **o** Nequi, para recibir los pagos.
- **RUT en PDF original emitido por la DIAN** (no fotos ni capturas).
- Persona natural o jurídica. Activación 100% en línea.

---

## 6. Consideraciones para un caso de cobro por consumo variable

Escenario típico: tarjeta guardada, cobro automático al terminar cada servicio, con **monto distinto cada vez**.

**Configuración correcta:**

- Fuente de pago **creada con 3DS** (para que los cobros viajen bajo 3RI).
- Transacciones con **`recurrent: false`** (COF almacenada — montos variables, sin periodicidad).

**Restricciones que chocan entre sí y hay que validar con Wompi:**

1. **3RI solo opera en Mastercard.** Con Visa se puede crear una fuente de pago autenticada con 3DS, pero los cobros automáticos posteriores **no viajan bajo 3RI**.
2. **COF exige procesador RBM.** Si el procesador asignado al comercio es otro, la transacción se procesa **sin COF**, sin error visible, y se pierde el beneficio en tasa de aprobación.
3. La disponibilidad de 3DS por franquicia **cambia según el modelo** (Gateway o Agregador).

**Preguntas a confirmar por escrito con el ejecutivo comercial:**

- ¿Qué procesador queda asignado al comercio (¿RBM?) y en qué modelo?
- ¿Cómo queda la **responsabilidad por contracargo** en cada franquicia, con y sin 3RI?
- ¿Cuál es el **plazo máximo real** para solicitar reembolsos?
- ¿Hay costo asociado a reembolsos o contracargos?

---

## 7. Fuentes

**Documentación técnica**

- [Fuentes de pago & Tokenización](https://docs.wompi.co/docs/colombia/fuentes-de-pago/)
- [Transacciones automáticas con el protocolo 3RI](https://docs.wompi.co/docs/colombia/fuentes-de-pago-3ds/)
- [Fuentes de Pago Seguras con 3D Secure (Sandbox)](https://docs.wompi.co/docs/colombia/fuentes-de-pago-3ds-sandbox/)
- [Transacciones con 3D Secure (Sandbox) v2](https://docs.wompi.co/docs/colombia/transacciones-con-3d-secure-v2/)
- [Integración de 3D Secure externo](https://docs.wompi.co/docs/colombia/integracion-3ds-externo/)
- [Transacciones](https://docs.wompi.co/docs/colombia/transacciones/)
- [Reembolsos V2 (Sandbox)](https://docs.wompi.co/docs/colombia/reembolsos-sandbox/)
- [Métodos de pago](https://docs.wompi.co/docs/colombia/metodos-de-pago/)
- [Referencia del API — OpenAPI 1.2.0](https://app.swaggerhub.com/apis-docs/waybox/wompi/1.2.0)

**Planes y tarifas**

- [Planes y tarifas](https://wompi.com/es/co/planes-tarifas/)
- [Plan Avanzado Agregador](https://wompi.com/es/co/planes-tarifas/plan-avanzado-agregador)
- [Plan Avanzado Gateway](https://wompi.com/es/co/planes-tarifas/plan-gateway)

**Centro de soporte**

- [¿Cómo se gestiona la reversión de una transacción con Tarjeta de crédito?](https://soporte.wompi.co/hc/es-419/articles/360046916653--C%C3%B3mo-se-gestiona-la-reversi%C3%B3n-de-una-transacci%C3%B3n-con-Tarjeta-de-cr%C3%A9dito)
- [¿Qué es reembolso total y qué pasa con los impuestos previamente liquidados?](https://soporte.wompi.co/hc/es-419/articles/1500009267322--Qu%C3%A9-es-reembolso-total-y-qu%C3%A9-pasa-con-los-impuestos-previamente-liquidados)
- [¿Qué pasa con los impuestos cuando hay reembolsos y anulaciones?](https://soporte.wompi.co/hc/es-419/articles/1500009267462--Qu%C3%A9-pasa-con-los-impuestos-cuando-hay-reembolsos-y-anulaciones)
- [¿Qué cobros adicionales se generan sobre las transacciones aprobadas?](https://soporte.wompi.co/hc/es-419/articles/360042471394--Qu%C3%A9-cobros-adicionales-se-generan-sobre-las-transacciones-aprobadas)
- [¿Cómo puedo anular una trx con tarjeta?](https://soporte.wompi.co/hc/es-419/articles/24298764333971--C%C3%B3mo-puedo-anular-una-trx-de-con-tarjeta)
