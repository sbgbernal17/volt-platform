# 0026. Potencia del gabinete compartida entre conectores

Fecha: 2026-09-30. Estado: aceptada.

## Contexto

El dueño confirmó cómo funcionan los cargadores de 180 kW: el gabinete entrega hasta 180 kW a un solo vehículo y, cuando los dos conectores cargan a la vez, regula y nivela la potencia entre ellos. Los conectores del parque son CCS2, CCS1 y GB/T (ADR 0003, actualización del 22-09-2026). Hasta ahora la potencia solo existía por conector (`assets.connector.max_power_w`), el back-office la ponía en 180 kW por conector y la app mostraba cada conector como "180 kW", como si los dos pudieran entregarla al mismo tiempo. El capítulo DAT §3 ya preveía `charge_point.max_power_w`, pero no se había implementado.

## Decisión

1. Se añade `assets.charge_point.max_power_w` (migración 0010): la potencia máxima del gabinete. La potencia por conector sigue siendo la que recibe un conector cuando carga solo.
2. El reparto es una regla derivada, sin banderas: la potencia está **compartida** cuando el gabinete tiene más de un conector y su máximo es menor que la suma de lo que cada conector podría tomar por separado (`isPowerShared` en `@volt/csms`, y la misma regla en SQL para las listas y para `/v1/locations`). Un gabinete de 180 kW con dos conectores de 90 kW fijos no está compartido; con dos de 180 kW, sí.
3. La app y el back-office dicen "hasta 180 kW" y explican el reparto ("potencia compartida entre conectores"); la app pública recibe `chargerMaxPowerKw` y `powerShared` por conector y sigue recibiendo `maxPowerKw`.
4. El back-office permite fijar la potencia del gabinete al crear el cargador (180 kW por defecto) y editar gabinete y conectores después (`PATCH /admin/v1/charge-points/:id/power`, auditado).
5. El nivelado lo hace el gabinete. La plataforma no envía `ChargePointMaxProfile`; el smart charging por sede y por gabinete sigue en la fase 2 del plan. El simulador y el cargador sintético reparten la potencia entre transacciones activas para que la app muestre lo que pasará con dos vehículos.
6. Nombres comerciales unificados en las dos interfaces: CCS2, CCS1, GB/T (DC), GB/T AC, CHAdeMO, Tipo 2, Tipo 1.

## Alternativas consideradas

- Bandera `power_sharing` en el cargador: explícita, pero se desincroniza con las potencias; la regla derivada no necesita mantenimiento.
- Modelar el reparto como perfil de carga (`charging_profile`, `ChargePointMaxProfile`): es lo correcto para *imponer* un límite, no para *describir* el equipo; queda para la fase 2.
- Bajar cada conector a 90 kW: falso cuando carga un solo vehículo y contradice lo que el conductor ve en el cargador.

## Consecuencias

- Los cargadores existentes reciben como potencia de gabinete la mayor de sus conectores (relleno de la migración); el cargador sintético pasa a 180 kW compartidos en dev y staging en el siguiente arranque.
- La lectura real de potencia en la carga en vivo sigue viniendo de `Power.Active.Import`; cuando el gabinete reparta, la app lo mostrará tal cual. `Power.Offered` se guarda pero no se muestra todavía.
- Pendiente del dueño: confirmar con el proveedor el reparto exacto del modelo (proporcional o por prioridad) para la fase 2.
