# 0011. Modelo de tarifas alineado con OCPI 2.2.1 y snapshot inmutable por sesión

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

Se requieren tarifas por franja horaria desde el MVP y precios dinámicos después, con visibilidad previa obligatoria del precio (Resolución 40123 de 2024) y compatibilidad futura con roaming y con el reporte regulatorio por OCPI 2.2.1 (Resolución 40559 de 2025).

## Decisión

El modelo de tarifas sigue el módulo Tariffs de OCPI 2.2.1 (`Tariff` → `TariffElement[]` → `PriceComponent[]` con `ENERGY`, `TIME`, `PARKING_TIME` y `FLAT`, más `TariffRestrictions`), con extensiones propias bajo `x_volt` para lo que OCPI no cubre (período de gracia del idle fee, tope por sesión). Al iniciar una sesión se congela un snapshot inmutable de la tarifa y de la política de cálculo; ningún cambio posterior afecta sesiones en curso. El motor de costo es una función pura y determinista `compute(snapshot, eventos, política)` con dinero en enteros de unidad mínima, redondeo configurable (`HALF_UP` por defecto) y política de impuestos por línea o por grupo. Los precios dinámicos son reglas declarativas versionadas que producen modificadores acotados sobre la tarifa base, evaluados una sola vez al inicio. El límite de exposición por sesión (ADR 0002) se implementa con los mismos eventos de aviso y agotamiento que la preautorización.

## Alternativas consideradas

- El modelo de franjas del proveedor (`UNIFORM_PRICE` y `TIME_SLOT_PRICING`): es un caso particular del modelo OCPI y se reproduce sin pérdida.
- Fórmulas libres para precios dinámicos: imposibles de auditar y de explicar al conductor; descartadas.

## Consecuencias

- `packages/tariff-engine` fija ya los tipos del contrato; la implementación y las pruebas de propiedad llegan en la iteración 4, con el ejemplo verificado de TAR §6 como caso de referencia.
- El cálculo con OCPP 1.6 usa `Energy.Active.Import.Register` en Wh e interpola en los bordes de franja; OCPP 1.6 no transporta tarifas al cargador, así que el precio se muestra en la app y en el QR.
