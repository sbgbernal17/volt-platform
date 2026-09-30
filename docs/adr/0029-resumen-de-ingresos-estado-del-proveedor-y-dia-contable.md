# 0029. Resumen de ingresos, estado del proveedor de pagos y día contable en hora de Colombia

Fecha: 2026-09-30. Estado: aceptada.

## Contexto

El dueño preguntó cómo revisar en el back-office "todo el tema transaccional, la plata que ha ingresado por Wompi" y cómo saber si Wompi funciona. La pantalla de Pagos listaba los últimos 100 cobros sin totales, sin filtros ni fechas, y no había ninguna señal de salud del proveedor. Además la conciliación diaria y el botón "Conciliar hoy" usaban el día UTC, que en Colombia corta a las 7 de la noche.

## Decisión

1. **Resumen de ingresos** (`GET /admin/v1/billing/summary`): cobrado (CAPTURE y DEBT aprobados), devuelto, anulado, neto, pendiente, rechazado y errores técnicos, por día y por medio de pago (tarjeta, Nequi, enlace), más la deuda abierta y lo facturado en sesiones liquidadas. Los períodos (hoy, 7 días, mes, 30 días) y las fechas son días de Colombia. Por defecto solo cuenta el ambiente de la pasarela configurada, para no mezclar sandbox con producción.
2. **Estado del proveedor** (`GET /admin/v1/billing/provider`): la pasarela expone `health()` (en Wompi, `GET /merchants/{llave pública}`: conectividad, llave y nombre del comercio, sin mover dinero) y la pantalla la combina con las señales de la base: último cobro aprobado, último webhook y sus resultados en 24 horas, cobros aprobados, rechazados y con error en 24 horas, pagos pendientes, alarmas de conciliación abiertas y medios de pago sin confirmar.
3. **Día contable en hora de Colombia** (`America/Bogota`, sin horario de verano): la conciliación diaria del worker y el botón "Conciliar hoy" trabajan sobre [00:00, 24:00) de Bogotá; los filtros de fechas de la lista de cobros también.
4. La lista de cobros gana filtros (estado, tipo, fechas) y muestra la referencia de Wompi (`psp_reference`) para cruzar con el panel del proveedor.
5. Lo que **no** se modela: comisiones de Wompi, retenciones y fecha de abono a la cuenta. El dinero neto que entra a la cuenta sigue viéndose en el panel de Wompi; el resumen muestra lo cobrado a los conductores.

## Alternativas consideradas

- Consultar los ingresos directamente a la API de Wompi: no ofrece agregados y mezclaría dos fuentes de verdad; la base de la plataforma ya tiene cada transacción con su referencia.
- Una vista materializada o tabla de agregados: innecesaria con el volumen del piloto; los índices nuevos (0012) bastan.

## Consecuencias

- Índices nuevos en `billing.payment` y `billing.webhook_inbox`.
- De paso se corrigieron dos fallos de la pantalla: el importe de una devolución parcial se leía con un valor viejo, y los errores de carga quedaban ocultos; los estados reales de los cobros (`SUCCEEDED`, `CANCELLED`) ya tienen color.
- Pendiente para producción: cuando existan las llaves de producción, el resumen mostrará ese ambiente por defecto y el sandbox quedará en `environment=sandbox`.
