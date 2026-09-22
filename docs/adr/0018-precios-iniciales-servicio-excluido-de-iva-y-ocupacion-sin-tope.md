# 0018. Precios iniciales de Volt, servicio de carga excluido de IVA y ocupación sin tope de tiempo

Fecha: 2026-09-22. Estado: aceptada. Actualiza el ADR 0012 (valores de la tarifa inicial) y el ADR 0017 (impuestos).

## Contexto

Al cerrar la iteración 4 el dueño del proyecto entregó las cifras reales que faltaban (punto 1 a 3 de "Pendiente ahora" en `docs/tareas-del-dueno.md`): el precio por kWh por franja, el régimen de IVA del servicio, el tiempo máximo de una carga y cómo tratar el tiempo que la pistola sigue conectada. Todo debe poder cambiarse sin tocar código.

## Decisión

1. **Tarifa base `VOLT-BASE` versión 1** (constante `VOLT_BASE_TARIFF` y fixture `volt-colombia-tarifa-base.json`): energía a **1.350 COP por kWh de 05:00 a 20:00** y **1.200 COP por kWh de 20:00 a 05:00**, hora de Bogotá, todos los días; elemento de respaldo a 1.350 para cumplir la regla OCPI del elemento sin restricciones. Los precios se cambian creando y publicando una versión nueva desde el back-office (`POST /admin/v1/tariffs/{id}/versions` y `.../publish`); las sesiones en curso conservan la versión que vieron (snapshot, ADR 0017).
2. **Servicio de carga excluido de IVA.** Según el dueño, el servicio de carga de vehículos eléctricos está excluido del impuesto: los componentes de la tarifa no llevan `vat`, el motor calcula impuesto cero y el recibo no desglosa IVA. El mecanismo de precios con impuesto incluido del ADR 0017 sigue disponible por si cambia el régimen o aparecen otros tributos: bastaría publicar una versión con `vat` en sus componentes. La confirmación escrita del contador se archiva en `docs/legal/` cuando llegue (punto 4 de "Pendiente ahora").
3. **Ocupación sin tope de tiempo.** Tras 15 minutos de gracia se cobran 1.500 COP por minuto (90.000 por hora, semántica OCPI) **mientras el vehículo siga conectado**, sin `max_idle_s`. La liquidación espera el fin de la ocupación hasta 24 horas (`session.idle_settle_timeout_s`, migración 0005) y después cierra administrativamente con la bandera `IDLE_TIMEOUT`; una ocupación de más de 24 horas pasa a revisión del operador.
4. **Duración máxima de la carga: 4 horas** (`session.max_duration_min` = 240): al superarla la plataforma envía `RemoteStopTransaction`. El tiempo de ocupación posterior no cuenta para este límite.

## Alternativas consideradas

- **Tope de ocupación de 4 horas (`max_idle_s`, ADR 0012)**: descartado por decisión del dueño; se conserva la alarma operativa por ocupación prolongada como tarea de la iteración 6 (back-office).
- **Modelar la exclusión de IVA con `vat: "0"`**: equivalente para el motor; se prefiere omitir el componente para que la exportación OCPI no declare una tasa.

## Consecuencias

- Las pruebas del motor, del núcleo y de aceptación usan estas cifras; el laboratorio publica esta tarifa con `POST /admin/v1/tariffs/bootstrap`.
- Los textos de la app y del recibo dicen "servicio excluido de IVA" hasta que el contador indique otra cosa.
- Una sesión que se quede conectada muchas horas genera importes altos de ocupación; el tope de exposición (200.000 COP) no la detiene porque la transacción ya terminó: el operador verá la alarma y podrá ajustar el cobro con un `ADJUSTMENT` manual (iteración 6).
