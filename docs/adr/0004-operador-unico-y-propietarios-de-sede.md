# 0004. Operador único con propietarios de sede en el futuro

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

La empresa operará sus propias estaciones. Más adelante habrá clientes que instalen estaciones que la empresa operará; esos clientes tendrán acceso a la plataforma para ver la información de sus estaciones, pero el núcleo de la plataforma es de la empresa.

## Decisión

1. **Un solo tenant operativo (Volt) en el MVP.** El modelo de datos conserva `tenant_id` y el aislamiento por filas desde el día uno, como ya prevé el diseño, para no cerrar la puerta a operar plataformas de terceros en el futuro.
2. **Los clientes que instalen estaciones se modelan como propietarios de sede dentro del tenant Volt**, no como tenants separados: una entidad `partner` (propietario) asociada a una o varias `site`, y un rol `site_owner` con alcance limitado a sus sedes y permisos de solo lectura: estado de sus cargadores, sesiones, energía, ingresos y reportes. No pueden operar cargadores, cambiar tarifas ni ver datos de otros propietarios.
3. **Reparto de ingresos** (porcentaje o esquema por sede) como parámetro de la sede y reporte mensual por propietario, en la fase 2 junto con el portal de propietarios.
4. El back-office de operación (comandos, tarifas, configuración, pagos) queda reservado a los roles internos.

## Alternativas consideradas

- Un tenant por cliente (multi-operador completo con marca blanca): innecesario mientras el núcleo y la operación sean de la empresa; se puede evolucionar después porque el modelo de datos ya es multi-tenant.

## Consecuencias

- El RBAC del MVP incluye los roles internos (administrador, operaciones, soporte, lectura) y deja definido `site_owner` para activarlo en la fase 2.
- Los reportes por sede y el portal de propietarios entran en la fase 2 como entregables concretos, en lugar de "multi-tenant en interfaz".
