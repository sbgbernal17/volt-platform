# Documentación de diseño del CSMS Volt Platform

Orden de lectura recomendado: primero el plan de trabajo y el resumen ejecutivo; después los capítulos según el rol.

| Archivo | Código | Contenido | Para quién |
|---|---|---|---|
| [`plan-de-trabajo.md`](plan-de-trabajo.md) | — | Plan vivo: decisiones, acciones inmediatas, fases, traspaso de cargadores, equipo, riesgos, métricas | Todos |
| [`00-resumen-ejecutivo.md`](00-resumen-ejecutivo.md) | — | Respuestas directas, arquitectura en una página, puntos clave, seguridad, tarifas, hechos verificados, requisitos al proveedor, decisiones, roadmap, estado de verificación | Dueño del proyecto, líder técnico |
| [`01-cargadores-y-migracion.md`](01-cargadores-y-migracion.md) | HW | Qué revela el documento del proveedor, requisitos de hardware, cómo reconfigurar la URL del Central System, plan de traspaso por lotes con rollback, tabla de equivalencias proveedor → OCPP | Líder técnico, QA y laboratorio |
| [`02-arquitectura-y-google-cloud.md`](02-arquitectura-y-google-cloud.md) | ARQ | Descomposición del sistema, app vs CSMS, contrato app-backend, diagramas, GKE vs Cloud Run, enrutamiento de comandos, escalado, stack, monorepo, DDL inicial, costos | Backend, DevOps |
| [`03-alcance-funcional-y-parametros.md`](03-alcance-funcional-y-parametros.md) | FUN | 21 módulos mapeados a mensajes y feature profiles de OCPP 1.6, catálogo de configuration keys y parámetros de negocio por nivel, priorización por fases, casos de uso | Producto, backend |
| [`04-tarifas-y-precios-dinamicos.md`](04-tarifas-y-precios-dinamicos.md) | TAR | Modelo de tarifas OCPI, reglas dinámicas, snapshot por sesión, cálculo con OCPP 1.6, regulación por país, ejemplo calculado, casos de prueba, API interna | Backend, negocio |
| [`05-seguridad.md`](05-seguridad.md) | SEG | Modelo de amenazas por superficie, perfiles OCPP y rotación de credenciales, PKI, identidad, pagos, datos personales, infraestructura, ciclo de desarrollo, checklist P0/P1/P2 | DevOps, backend, seguridad |
| [`06-modelo-de-datos-y-eventos.md`](06-modelo-de-datos-y-eventos.md) | DAT | Entidades, máquinas de estado de conector y sesión, catálogo de eventos, outbox, casos difíciles, retención y volúmenes, DDL completo y consultas | Backend |
| [`07-operacion-y-roadmap.md`](07-operacion-y-roadmap.md) | OPS | Comisionamiento, observabilidad, alarmas, SLOs, runbooks, pruebas y certificación, despliegue sin cortes, decisiones, roadmap, app del conductor, riesgos, métricas | DevOps, operaciones, producto |
| [`anexo-a-registro-revision.md`](anexo-a-registro-revision.md) | — | Registro de la revisión técnica independiente: errores corregidos, puntos añadidos y afirmaciones a confirmar por capítulo | Líder técnico |
| [`sql/ddl_local.sql`](sql/ddl_local.sql) | — | DDL del modelo de datos validado en PostgreSQL 16 (sin PostGIS, pg_partman ni pg_cron) | Backend |

Convenciones: los capítulos se citan entre sí por su código y sección (por ejemplo, "ARQ §4.4"). Las afirmaciones marcadas con `[V]` fueron contrastadas con fuentes primarias o implementaciones de referencia; las marcadas "(a confirmar)" quedan pendientes de verificación con el proveedor, con la unidad piloto o con la calculadora de precios de Google Cloud. Las decisiones de arquitectura se registran como ADR en `docs/adr/` a medida que se toman.
