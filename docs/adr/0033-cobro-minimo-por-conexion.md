# 0033. Cobro mínimo por conexión de 2.000 COP

Fecha: 2026-10-01. Estado: aceptada.

## Contexto

El dueño fijó el 01-10-2026 un cobro mínimo por conexión de 2.000 COP: toda sesión de carga cuesta al menos eso, aunque la energía entregada valga menos (conexiones de segundos, vehículos que no aceptan carga, pruebas del conductor). Las tarifas se expresan en el modelo OCPI 2.2.1 (ADR 0011), que ya define `min_price`, y el motor de tarifas (`@volt/tariff-engine`) ya lo calculaba como línea `CAP` con `element_ref = min_price`; la tarifa base `VOLT-BASE` (ADR 0018) no lo usaba.

## Decisión

1. **El mínimo es parte de la tarifa, no una regla aparte del motor.** `VOLT_BASE_TARIFF` lleva `min_price: { excl_vat: '2000', incl_vat: '2000' }` (el servicio está excluido de IVA, ADR 0018). Se edita desde el back-office como cualquier otro campo del editor guiado y queda en el snapshot de cada sesión (TAR §3), así que las sesiones iniciadas antes del cambio no se tocan.
2. **Cómo se presenta.** El motor añade la línea `CAP` / `min_price` con la diferencia hasta el mínimo; el recibo HTML y PDF, la app y el back-office la nombran "Cobro mínimo por conexión" (y "Tope de precio" cuando el `element_ref` es `max_price`). El costo en curso también lo incluye: desde el primer segundo el conductor ve 2.000 COP, que es lo que pagará como mínimo. La ficha del cargador en la app muestra "Cobro mínimo por conexión: 2.000 COP" y el precio público (`/v1/locations`) expone `minPrice`.
3. **La versión publicada se actualiza sola.** `ensureBaseTariff` (arranque de la API con cargador sintético en dev y staging, y `POST /admin/v1/tariffs/bootstrap`) publica una versión nueva de `VOLT-BASE` cuando la vigente no tiene `min_price` y no fue personalizada desde el back-office; las notas de la versión dicen por qué. Si el dueño ya editó la tarifa, no se toca: el mínimo se añade a mano en el editor.
4. **Relación con el tope de exposición (ADR 0017).** El tope por sesión (200.000 COP por defecto) debe ser mayor que el mínimo; un tope menor detendría cualquier sesión en la primera lectura. La prueba de aceptación del tope usa 2.100 COP.

## Alternativas consideradas

- Cargo fijo por sesión (`FLAT` de 2.000 COP además de la energía): cobraría 2.000 más la energía; no es lo pedido.
- Parámetro de plataforma (`pricing.min_session_minor`) aplicado en la liquidación: duplicaría lo que OCPI ya define y no quedaría en el snapshot de la sesión ni en el simulador del back-office.

## Consecuencias

- Las sesiones muy cortas pasan a cobrarse 2.000 COP; el resumen de ingresos no cambia de forma (usa totales) y los informes por línea tienen la dimensión `CAP` con `element_ref` `min_price`.
- El fixture `volt-colombia-tarifa-base.json`, las pruebas del motor y las de aceptación de la API (recibo con línea `CAP`, tope de exposición de 2.100 COP) quedan actualizadas.
