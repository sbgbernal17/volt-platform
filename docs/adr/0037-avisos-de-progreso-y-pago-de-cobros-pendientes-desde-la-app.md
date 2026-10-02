# ADR 0037. Avisos de progreso de la carga y pago de cobros pendientes desde la app

- Estado: aceptado (02-10-2026, peticiones del dueño tras probar las apps de las tiendas)
- Decisores: dueño del proyecto, Claude Code
- Relacionados: ADR 0020 (cobros con Wompi), ADR 0022 (app y avisos push), ADR 0025 (diseño de la app)

## Contexto

El dueño probó las apps de iOS y Android y pidió once correcciones. Dos de ellas son decisiones de
producto que conviene dejar escritas:

1. **"¿Es posible incluir notificaciones en vivo con el estado de la carga y la energía entregada?"**
   Hoy el conductor recibe push al iniciar la carga, al detenerse el vehículo (ocupación), al
   acercarse al límite por sesión, al terminar y al cobrar. Entre el inicio y el fin no hay ninguna
   señal; la "carga en vivo" solo existe dentro de la app.
2. **"Al pagar un cobro pendiente con una tarjeta válida sale error interno y remite a soporte."**
   El enlace de pago de Wompi fallaba porque el `sku` superaba 36 caracteres (`DEBT-<uuid>` tiene 41)
   y la API convertía el rechazo del proveedor en un 500 genérico; además la única forma de pagar era
   el checkout en el navegador, aunque el conductor ya hubiera registrado una tarjeta válida, y el
   bloqueo por deuda se mostraba como "cuenta bloqueada, contacte a soporte".

## Decisión

### Avisos de progreso (clase `CHARGING_PROGRESS`)

- El worker escucha `session.metered` y envía un push **cada vez que la energía entregada cruza un
  múltiplo de `notifications.progress_step_kwh`** (parámetro por plataforma o tenant, por defecto
  5 kWh), una sola vez por escalón y nunca antes de 5 minutos del aviso anterior de la misma carga,
  solo mientras la sesión sigue en el cargador (`CHARGING`, `SUSPENDED_EV`, `SUSPENDED_EVSE`) y nunca
  en sesiones de prueba. Texto: "Carga en curso · 12,5 kWh entregados en 25 minutos · 45 kW ·
  $ 16.875 hasta ahora" (español e inglés, formato colombiano del manual de marca).
- La clase entra en la lista por defecto de `notifications.push_kinds`; un tenant puede quitarla.
  Queda registrada en la bandeja de avisos de la app como las demás.
- No se usan Live Activities de iOS ni notificaciones persistentes de Android: exigen módulos
  nativos y una compilación nueva en las tiendas; se evaluarán en la iteración 10 si el dueño las
  quiere después de probar los avisos por escalón.

### Pago de cobros pendientes desde la app

- `sku` del enlace de pago limitado a 36 caracteres (los últimos, que llevan el identificador); el
  pago se concilia por `payment_link_id`, no por el `sku`.
- Un rechazo de la pasarela (`PaymentGatewayError`) responde `PSP_<código>` con 502 (o 503 si se
  puede reintentar) y el mensaje del proveedor; ya no es un "error interno".
- Nueva ruta `POST /v1/debts/:id/retry`: cobra la deuda a la tarjeta guardada (principal, o la
  primera disponible) de inmediato, con las mismas reglas del reintento del back-office. Responde
  `charged`, `pending`, `failed` (con el motivo del banco) o `skipped`; no duplica un cobro en
  curso. Transacciones ofrece "Cobrar a VISA •••• 4242" y, como alternativa, "Pagar con otro medio"
  (enlace de Wompi: PSE, Nequi u otra tarjeta); sin tarjeta lista, "Agregar una tarjeta para pagar"
  vuelve a Transacciones.
- El bloqueo por deuda se informa como `DEBT_PENDING` ("Tiene un cobro pendiente. Páguelo para
  volver a cargar") con el botón *Pagar ahora*; `DRIVER_BLOCKED` ("contacte a soporte") queda solo
  para el bloqueo manual del personal.

### Otras correcciones del mismo lote (sin decisión nueva)

Selección de tarjeta desde la pantalla del cargador (`/payment-methods?select=1&returnTo=…`, la
tarjeta elegida queda como principal y se vuelve al cargador; al agregar una tarjeta se vuelve al
mismo sitio y la pantalla recarga el medio de pago al recibir el foco), Configuración (idioma, tema y
estado de los avisos push; el permiso se pide al entrar y ya no hay "Activar avisos" en Cuenta),
chulo de verificado dentro de los campos de correo y celular, perfil compacto con autocompletado
(`autoComplete`/`textContentType`), pantalla de carga con la marca, cabecera de la hoja del mapa
alineada y tocable, sello "Pagos procesados por Wompi" y franquicias en color en Medios de pago.

El **tema claro** no se entrega en este lote: los tokens de color de la app son solo oscuros
(ADR 0025) y las pantallas usan `StyleSheet.create` con esos valores; un tema claro real exige un
proveedor de tema y la revisión de todas las pantallas. Configuración lo muestra como "próxima
versión" y queda en el plan de la iteración 10.

## Alternativas consideradas

- **Progreso por tiempo (cada N minutos)** en lugar de por energía: más predecible, pero avisa
  aunque el vehículo no cargue; el escalón por kWh informa lo que el conductor quiere saber (energía
  y costo) y el mínimo de 5 minutos evita ráfagas en cargadores rápidos.
- **Reusar el enlace de pago para todo** (sin reintento con tarjeta guardada): no exige cambios en
  la API, pero obliga a escribir la tarjeta otra vez en el navegador y no resuelve la queja.
- **Dejar `DRIVER_BLOCKED` para la deuda** y cambiar solo el texto de la app: el back-office y los
  recibos de rechazo seguirían diciendo "contacte a soporte"; el código correcto es el de la deuda.

## Consecuencias

- Migración `1759449600000_avisos_de_progreso_de_carga.sql`: parámetro
  `notifications.progress_step_kwh` y `CHARGING_PROGRESS` en la lista por defecto.
- Cada `session.metered` pasa por la bandeja del consumidor `push` (una fila por evento, con el
  motivo de omisión); a la escala actual es despreciable y se revisará con el volumen real.
- La prueba de aceptación de pagos cubre el reintento desde la app (rechazado con la tarjeta
  rechazada, aprobado con la válida, 409 si la deuda ya está pagada, 404 para otro conductor).
- Qué revisar después: que los avisos cada 5 kWh no resulten molestos en cargas largas (ajustar el
  parámetro), Live Activities para iOS, y el tema claro.
