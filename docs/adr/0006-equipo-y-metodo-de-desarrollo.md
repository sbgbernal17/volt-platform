# 0006. Equipo y método de desarrollo

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

El diseño suponía un equipo de cuatro personas más media de QA. El dueño del proyecto decidió que el desarrollo lo hará Claude Code, con él como dueño del producto y operador.

## Decisión

1. **Claude Code desarrolla la plataforma** (gateway OCPP, API, worker, back-office, app Volt, infraestructura como código, pruebas y documentación) en este repositorio, trabajando por iteraciones cortas que terminan en pull requests con CI en verde y notas de qué probar.
2. **El dueño del proyecto** decide prioridades, acepta cada iteración, prueba en staging con el cargador real y conserva todo lo que no se puede delegar a una IA: cuentas y facturación de Google Cloud, Wompi, DIAN, Apple y Google Play; custodia de secretos y accesos; contratos y relación con el proveedor de cargadores, el contador y el asesor legal; trabajo físico en el laboratorio y en las sedes; y la operación 24 x 7 con la respuesta a incidentes.
3. **Roles humanos mínimos recomendados a medida que crezca el parque:** una persona de operaciones y soporte (guardia, runbooks, atención a conductores) y, con 30 estaciones, una de mantenimiento en campo. La observabilidad y los runbooks del capítulo OPS están pensados para que una persona pueda operar con ayuda de la plataforma.
4. **Método de trabajo por iteración:** objetivo y criterios de aceptación escritos en el plan de trabajo; desarrollo con pruebas automatizadas (unitarias, contract tests OCPP, integración con simuladores); despliegue automático a dev; revisión de seguridad en cada PR que toque autenticación, pagos o el gateway; prueba de aceptación en staging por el dueño; registro de decisiones nuevas como ADR.

## Consecuencias

- El ritmo de escritura de código deja de ser el cuello de botella; el calendario lo marcan las dependencias externas: respuesta del proveedor de cargadores, laboratorio, activación de Wompi, elección del proveedor tecnológico de facturación, lectura legal de la regulación, publicación en las tiendas de apps y disponibilidad del dueño para probar y aceptar.
- Las duraciones por fase del capítulo OPS se reemplazan por un plan de iteraciones (plan de trabajo, sección 5) y se re-estiman al cerrar cada iteración.
- Los presupuestos de infraestructura y herramientas no cambian; el presupuesto de personal se reduce al uso de Claude Code y a los roles humanos mínimos.
