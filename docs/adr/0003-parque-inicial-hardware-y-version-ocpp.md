# 0003. Parque inicial, hardware, versión OCPP y perfil de seguridad

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

El dueño del proyecto informó: se inicia con 3 estaciones de carga rápida DC de 180 kW con dos mangueras cada una; se esperan 30 estaciones en el primer año; pronto habrá también estaciones de 40 kW con dos mangueras; los equipos vienen con OCPP 1.6J; la mayoría de las estaciones son de acceso público; hoy no se opera (no hay clientes, tarjetas ni transacciones que migrar); se puede disponer de un cargador para pruebas.

## Decisión

1. **Alcance del parque:** dimensionar el MVP para 3 estaciones y el primer año para 30 estaciones (60 a 70 conectores). La infraestructura se dimensiona en el tramo más pequeño del capítulo ARQ §7 (orden de 400 a 650 USD al mes en precios de lista, a recalcular).
2. **Hardware DC de 180 kW y 40 kW con dos conectores:** el inventario modela cada estación como un `charge_point` con dos `evse`/`connector` (CCS2, a confirmar con el proveedor). La plantilla de configuración para DC usa `MeterValueSampleInterval` de 10 a 15 segundos y `MeterValuesSampledData` con `Energy.Active.Import.Register`, `Power.Active.Import`, `Voltage`, `Current.Import`, `SoC` y, si existen, `Power.Offered` y `Current.Offered`. Se registra por modelo cómo reparte la potencia el gabinete entre las dos mangueras (180 kW a una o 90 y 90 kW a dos) porque afecta a la tarifa por potencia, al smart charging y a la información que ve el conductor.
3. **OCPP 1.6J en producción** con el dominio modelado a 2.0.1 y gateway 2.0.1 en la fase 3, como recomendaba el diseño. Queda abierta la lectura legal de la Resolución 40123 de 2024, que exige "la última versión estable" de OCPP en estaciones de acceso público: se confirmará con el Ministerio o un asesor si 1.6J se acepta; las compras nuevas exigirán certificación OCA y capacidad de actualizar a 2.0.1.
4. **Perfil de seguridad OCPP 2 desde el primer cargador en producción y perfil 3 en la fase 2**, según SEG S1.
5. **Sin migración de operación previa:** el plan de traspaso del capítulo HW se aplica como plan de puesta en marcha de equipos nuevos (inventario, laboratorio, checklist, lotes, rollback) sin exportación de historial ni migración de clientes o tarjetas RFID.
6. **Laboratorio:** un cargador real disponible para pruebas desde la fase 0, junto con dos simuladores de cargador.

## Consecuencias

- Al ser carga rápida, el idle fee y la rotación de conectores importan más que en AC: el idle fee se mantiene en la fase 2 pero con prioridad alta, y la app debe avisar con claridad el fin de carga.
- Los importes por sesión son altos (una carga completa a 180 kW puede superar con creces el costo de una sesión AC), lo que refuerza el límite de exposición por sesión del ADR 0002.
- El smart charging inicial es por sede (límite de potencia contratada) y por gabinete (reparto entre mangueras); se documenta por modelo en la matriz de conformidad.
- Los requisitos al proveedor (resumen ejecutivo §8) se envían por modelo: 180 kW y 40 kW, con especial atención a measurands DC, `SoC`, reparto de potencia, `SetChargingProfile`, mecanismos de cambio de URL y perfiles de seguridad.

## Actualización 2026-09-22: conectores del parque inicial

El dueño precisó que cada estación trae una combinación distinta de conectores: la estación 1 tiene **CCS1 y CCS2**, la 2 **dos CCS2** y la 3 **CCS2 y GB/T**. El inventario ya lo modela por conector (`assets.connector.standard`: `IEC_62196_T1_COMBO` para CCS1, `IEC_62196_T2_COMBO` para CCS2 y `GBT_DC` para GB/T), la app muestra el tipo de cada EVSE y las tarifas pueden diferenciarse por tipo de conector con asignaciones de alcance `CONNECTOR_TYPE` (ADR 0017). Al comisionar cada estación se registra la combinación real de sus mangueras; el simulador del laboratorio puede reproducir cualquier combinación.
