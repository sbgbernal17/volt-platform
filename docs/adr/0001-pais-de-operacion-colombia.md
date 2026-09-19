# 0001. País de operación: Colombia

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

El diseño del CSMS se hizo sin asumir país porque el país fija la moneda, los impuestos, la facturación electrónica, la regulación sectorial de carga, la ley de datos personales y la región de Google Cloud. El dueño del proyecto confirmó que el sistema operará en Colombia.

## Decisión

El tenant inicial opera en Colombia: moneda COP con redondeo a pesos enteros, zona horaria `America/Bogota`, idioma español, IVA parametrizado al 19 % con tratamiento del servicio de carga a confirmar con el contador, facturación electrónica DIAN mediante proveedor tecnológico habilitado desde el MVP, cumplimiento de las Resoluciones del Ministerio de Minas y Energía 40123 de 2024 (interoperabilidad: OCPP en su última versión estable, precios de carga, estacionamiento y otros costos visibles y desagregados antes de cargar, acceso y pago sin membresía) y 40559 de 2025 (reporte, gestión y consulta de información de estaciones de acceso público, conectores Tipo 2 y CCS2, OCPI 2.2.1, seguridad de la información y trazabilidad), tratamiento de datos personales según la Ley 1581 de 2012 y el Decreto 1377 de 2013, y despliegue en una región de Google Cloud fuera del país (recomendada `us-east1`, alternativas `northamerica-south1` y `southamerica-west1`) con verificación de la transferencia internacional de datos.

Nada específico de Colombia se codifica en el dominio: moneda, impuestos, redondeo, documento fiscal, idioma y zona horaria son parámetros del tenant, y la facturación electrónica y el reporte regulatorio se implementan como adaptadores.

## Alternativas consideradas

- Varios países desde el inicio: descartado; multiplica regulación, pasarelas y facturación sin clientes que lo justifiquen. El modelo multi-tenant deja la puerta abierta.
- Alojar en una región latinoamericana por cercanía (Santiago o Querétaro): válido; se decide por latencia medida desde Bogotá y por el análisis de transferencia internacional de datos, no por defecto.

## Consecuencias

- La facturación electrónica DIAN se adelanta de la fase 3 al MVP; hay que elegir proveedor tecnológico y confirmar con el contador el documento aplicable (factura electrónica de venta o documento equivalente electrónico) y el tratamiento tributario.
- El pago ad hoc sin registro es obligatorio en el MVP; la app y el QR deben mostrar precios desagregados antes de iniciar.
- El módulo OCPI 2.2.1 puede adelantarse a la fase 2 si la Resolución 40559 de 2025 exige reportar información por esa vía; se confirma leyendo el texto completo.
- La pasarela de pago debe soportar preautorización con captura parcial (PayU con flujo de dos pasos o Mercado Pago con reserva de fondos, a confirmar); PSE, Nequi y Daviplata se usan para recargar un wallet prepago, que conviene adelantar.
- La política de tratamiento de datos, la autorización en la app y, si aplica, el registro en el RNBD entran en la fase 0 o 1.
- Pendiente de confirmar: requisitos de trazabilidad o certificación del medidor según la Resolución 40559, nivel adecuado de protección de datos del país de la región elegida, plazos normativos.
