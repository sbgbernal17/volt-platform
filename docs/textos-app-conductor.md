# Textos para el conductor (propuesta)

> Estado 23-09-2026: estos textos ya viven en la app (`apps/mobile/src/i18n/es.ts` y `en.ts`) y en las notificaciones push (`packages/csms/src/drivers/push-texts.ts`, con pruebas). Cualquier ajuste del dueño se aplica ahí; este documento queda como referencia de la voz y de los ejemplos.

Propuesta para la app Volt y las notificaciones (iteración 7), escrita con la voz del manual de marca: trato de usted, frases cortas, sin exclamaciones, cifras en formato colombiano. El dueño ajusta lo que quiera; después viven en los archivos de recursos de la app (español e inglés) y nunca en código. Las cifras salen de los parámetros y de la tarifa vigente: aquí van los valores actuales (ADR 0018) como ejemplo.

## Nombre comercial de la tarifa

- **Tarifa VOLT**, con dos franjas: **VOLT Día** (5:00 a. m. a 8:00 p. m.) y **VOLT Noche** (8:00 p. m. a 5:00 a. m.).
- En el código la tarifa sigue siendo `VOLT-BASE`; el nombre comercial es el que ve el conductor.

## Precio visible antes de iniciar (Resolución 40123)

| Español | English |
|---|---|
| Tarifa VOLT Día: $ 1.350 por kWh (de 5:00 a. m. a 8:00 p. m.). VOLT Noche: $ 1.200 por kWh. | VOLT Day rate: $ 1.350 per kWh (5:00 a. m. to 8:00 p. m.). VOLT Night: $ 1.200 per kWh. |
| Ocupación: 15 minutos de cortesía al terminar la carga. Después, $ 1.500 por minuto mientras el vehículo siga conectado. | Idle fee: 15 courtesy minutes after charging ends. Then $ 1.500 per minute while the vehicle stays plugged in. |
| Servicio de carga excluido de IVA. | Charging service is VAT exempt. |
| Límite de esta sesión: $ 200.000. Al llegar, la carga se detiene sola. | Session limit: $ 200.000. Charging stops automatically when it is reached. |

Botón: **INICIAR CARGA** / **START CHARGING**. Confirmación: "Carga iniciada. Conecte el cable en los próximos 2 minutos." / "Charging started. Plug in the cable within 2 minutes."

## Durante la carga

| Español | English |
|---|---|
| 22,4 kWh cargados · 48 kW · $ 30.240 hasta ahora | 22,4 kWh charged · 48 kW · $ 30.240 so far |
| Carga pausada por el vehículo. El cobro de energía se detuvo. | Charging paused by the vehicle. Energy is not being charged. |

## Fin de la carga y ocupación

| Español | English |
|---|---|
| Carga completa: 22,4 kWh. Tiene 15 minutos de cortesía para desconectar el vehículo. | Charging complete: 22,4 kWh. You have 15 courtesy minutes to unplug your vehicle. |
| Ocupación en curso: $ 1.500 por minuto desde las 3:20 p. m. Desconecte el vehículo para detener el cobro. | Idle fee running: $ 1.500 per minute since 3:20 p. m. Unplug your vehicle to stop the charge. |
| Sesión terminada. Energía: $ 30.240. Ocupación: 12 minutos, $ 18.000. Total: $ 48.240. | Session ended. Energy: $ 30.240. Idle: 12 minutes, $ 18.000. Total: $ 48.240. |

## Avisos del límite por sesión

| Momento | Español | English |
|---|---|---|
| Al 80 % | Esta sesión va en $ 160.000 de un límite de $ 200.000. Al llegar al límite la carga se detendrá sola; puede iniciar otra sesión. | This session is at $ 160.000 of a $ 200.000 limit. Charging stops automatically at the limit; you can start another session. |
| Al detenerse | La carga se detuvo al llegar al límite de $ 200.000 de esta sesión. Puede iniciar una nueva carga. | Charging stopped at this session's $ 200.000 limit. You can start a new session. |

## Cobro y recibo

| Español | English |
|---|---|
| Cobro aprobado: $ 48.240 a la tarjeta terminada en 4242. Recibo N.º 1234 disponible en Historial. | Payment approved: $ 48.240 to the card ending in 4242. Receipt No. 1234 is available under History. |
| No pudimos cobrar $ 48.240 a su tarjeta. Actualice el medio de pago o pague el enlace para volver a cargar. | We could not charge $ 48.240 to your card. Update your payment method or pay the link to charge again. |
| Correo del recibo: "Su recibo de carga VOLT N.º 1234", remitente notificaciones@supercargadores.co. | Receipt email: "Your VOLT charging receipt No. 1234", sender notificaciones@supercargadores.co. |

## Errores frecuentes

| Español | English |
|---|---|
| El cargador 2 está fuera de servicio. Use el cargador 1 o 3. | Charger 2 is out of service. Use charger 1 or 3. |
| No detectamos el vehículo. Conecte el cable y vuelva a iniciar. | We did not detect the vehicle. Plug in the cable and start again. |
| Aún no tiene cargas este mes. Busque una estación en el mapa. | No charging sessions this month yet. Find a station on the map. |
