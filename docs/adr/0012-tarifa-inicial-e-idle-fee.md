# 0012. Tarifa inicial de Volt y política de idle fee

Fecha: 2026-09-22. Estado: aceptada.

## Contexto

El dueño del proyecto fijó las reglas comerciales iniciales: tarifas dinámicas según la hora, un tiempo de gracia al terminar la carga de 15 minutos (o variable) y, después, un cobro por ocupación de 1.500 pesos por minuto. Todo debe poder cambiarse sin desplegar código. Las estaciones son de carga rápida DC (ADR 0003), donde la rotación de conectores es crítica.

## Decisión

1. **Energía por franjas horarias** como tarifa base (modelo OCPI, ADR 0011): elementos `ENERGY` con precio por kWh en pesos y restricciones `start_time`/`end_time` (y `day_of_week` si hace falta), con un elemento de respaldo sin restricciones. Los precios por kWh de cada franja los define el dueño del proyecto en el back-office; el archivo `packages/tariff-engine/fixtures/volt-colombia-tarifa-base.json` trae valores de ejemplo, no comerciales.
2. **Precios dinámicos** (fase 2) como reglas declarativas que modifican la tarifa base según hora, ocupación u otras señales, evaluadas al inicio de la sesión y congeladas en el snapshot (ADR 0011).
3. **Idle fee (ocupación tras la carga):**
   - Componente `PARKING_TIME` con precio por minuto (`step_size` 60 segundos): valor inicial 1.500 COP por minuto.
   - Período de gracia inicial de 15 minutos (900 segundos) desde el fin de la carga; puede ser variable: las reglas dinámicas pueden fijar otro valor al inicio de la sesión (por ejemplo, según hora u ocupación) y ese valor queda en el snapshot.
   - El fin de la carga se detecta por lo primero que ocurra: `StopTransaction` o el cargador reportando `SuspendedEV` con potencia cercana a cero durante un tiempo configurable (vehículo lleno sin desconectar). La ocupación termina cuando el conector vuelve a `Available` (cable desconectado). Un tope máximo de minutos cobrables (`max_idle_s`) evita cobros desproporcionados si un vehículo queda abandonado; después del tope se genera una alarma operativa.
   - Aviso al conductor por notificación push al terminar la carga, unos minutos antes de vencer la gracia y al empezar el cobro; el tope de exposición por sesión (ADR 0002) incluye el idle fee.
4. **Parámetros configurables** en el motor de cinco niveles (plataforma, operador, sede, cargador, conector), con auditoría de cada cambio: precio por kWh por franja, precio por minuto de ocupación, gracia en segundos, criterio de fin de carga, umbral de potencia para `SuspendedEV`, tope de minutos, textos y umbrales de aviso. Los valores de esta decisión son los valores por defecto del tenant Volt.
5. **Visibilidad previa obligatoria** (Resolución 40123 de 2024): la app y el QR muestran, antes de iniciar, el precio por kWh vigente, el tiempo de gracia y el precio por minuto de ocupación, desagregados.

## Alternativas consideradas

- Cobrar la ocupación por tramos (por ejemplo, bloques de 5 minutos): más simple de explicar, pero menos justo; el modelo por minuto con `step_size` permite ambos si se cambia el parámetro.
- Gracia fija sin reglas: descartado; el dueño quiere que pueda variar.

## Consecuencias

- La iteración 4 implementa el motor con estos valores por defecto y con el caso de prueba "carga termina a las 18:00, gracia hasta 18:15, 23 minutos de ocupación cobrados a 1.500 COP" además del ejemplo verificado de TAR §6.
- El worker necesita temporizadores por sesión (fin de gracia, tope de minutos) y el gateway debe reportar `SuspendedEV`, potencia y `Available` con marcas de tiempo del cargador y del servidor.
- El recibo desglosa energía por franja, ocupación (minutos, gracia aplicada, precio por minuto) e impuestos.
