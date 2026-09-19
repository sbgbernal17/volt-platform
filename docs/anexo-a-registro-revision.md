# Anexo A. Registro de la revisión técnica de los capítulos

Cada capítulo de la Parte II fue sometido a una revisión independiente orientada a refutar sus afirmaciones con verificación de fuentes. Este anexo registra, por capítulo, la calificación inicial (antes de corregir, sobre 10), los errores corregidos en el texto, los puntos añadidos por faltar y las afirmaciones que quedaron marcadas como "a confirmar".


## A.1 Capítulo 1 (HW). Los cargadores, el proveedor y el traspaso al CSMS propio

Calificación inicial: 7.5 / 10. Errores corregidos: 13. Puntos añadidos: 7. Afirmaciones marcadas a confirmar: 9.


### Errores corregidos

| Sección | Error detectado | Corrección aplicada |
|---|---|---|
| 0. Resumen ejecutivo (punto 3) y 8. Fuentes | Fechaba la 4ª edición del OCPP 1.6 Security Whitepaper en marzo de 2026. | La OCA la publicó en febrero de 2026 (5-feb según resúmenes de la OCA; fecha exacta marcada 'a confirmar'). Se añadió también la referencia a la OCPP Security Operations Guide v1.0 (ene-2026) y el detalle de que Reservation/Local Auth List/Remote Trigger son opcionales dentro de Core en la certificación 1.6 post-oct-2025. |
| 2.1 Lo que un cargador OCPP-J tiene grabado | Presentaba el 'perfil de seguridad 0' como un perfil definido junto a 1/2/3. | Se aclara que el whitepaper define solo los perfiles 1, 2 y 3; el '0' (ws sin autenticación) es una convención de firmwares/librerías para 'sin seguridad' (valor 0 de la key SecurityProfile), útil solo en laboratorio. |
| 2.1 AuthorizationKey | Atribuía el límite de 20 bytes a 'implementaciones típicas'. | El propio whitepaper indica que el CSMS envía la clave como cadena hexadecimal de 40 caracteres que representa 20 bytes (mínimo recomendado 16 bytes, aleatoria); write-only (no aparece en GetConfiguration). Se añade que implementaciones como libocpp validan solo un mínimo de 8 caracteres sin máximo, y que el gateway debe aceptar la contraseña tal como la envíe cada firmware (bytes crudos o hex). |
| 2.2 Mecanismos para cambiar URL (fila 'App o portal') | Wallbox descrito con ruta de menú no verificable ('Connectivity → OCPP') y Zaptec marcado [E]. | Wallbox: app/portal → OCPP → URL + Charge Point ID (por defecto el número de serie) + password opcional, reinicio automático [V]. Kempower: 'Configure OCPP – Direct connection from charger to customer backend' con Endpoint URL, Charge point identity y Authorization key [V]. Zaptec: portal/API con endpoint para AuthorizationKey codificada [V]. |
| 2.2 (fila 'Web local') y 3 pregunta 6 | Afirmaba como verificado que en Teltonika la URL debe terminar en '/'. | No pudo confirmarse en la FAQ del fabricante; se deja como '(a confirmar)'. Se mantiene verificado que TeltoCharge se configura desde la app con URL del servidor + Charge point identity. |
| 2.2 (fila 'Herramienta de instalador') | Alfen: mencionaba la app 'MyEye' como verificada y la opción 'Manually enter Backoffice settings'; ABB TerraConfig marcado [E]. | Alfen: ACE Service Installer (solo Windows), pestaña Connectivity, owner password (que suele tener el back office actual), 'Manually enter backend settings' (URL + identifier), guardar y reiniciar [V]; MyEye queda 'a confirmar'. ABB: app TerraConfig, que no permite wss:// hacia servidores OCPP externos [V]. |
| 3. Preguntas al proveedor, pregunta 2 | Afirmaba que OCPP 2.0.1 'ya es exigido en varias jurisdicciones (NEVI, CALeVIP)' sin matices. | 23 CFR 680 (NEVI, EE. UU.) fijó 2.0.1 desde feb-2024, pero la guía del programa se reformuló en 2025 y su alcance actual queda a confirmar; CALeVIP marcado 'a confirmar'. Se precisa IEC 63584:2024 para 2.0.1 y la fecha exacta de OCPP 2.1 (23-ene-2025) e IEC 63584-210:2025 [V]. |
| 3. Pregunta 10 y 7. Decisiones pendientes | Citaba 'IEC 62053-21 clase 1' como referencia chilena verificada y presentaba la Resolución 40123/2024 de Colombia como norma de certificación de medidores. | RIC N°15 (SEC, Chile, versión 2024) exige que la unidad de medida cumpla IEC 62053-21 o superior [V]; la clase concreta queda 'a confirmar'. La Res. 40123 de 2024 (MinMinas, Colombia) regula la interoperabilidad de estaciones de acceso público: obliga a conectarse al sistema de gestión con la última versión estable de OCPP o norma ISO/IEC/Icontec equivalente (6 meses nuevas, 2 años existentes) [V]; RETIE es la certificación del equipo. |
| 4.2 Fase 1, punto 1 (simuladores y suites) | OpenChargingCloud/ChargingStationApp descrito como '1.6/2.0.1/2.1' y MicroOcpp como 'reconocido por operadores de backend'; tzi-OCTT y open-ocpp-tck sin detalle. | ChargingStationApp: 1.6J estable, 2.0.1 y 2.1 en desarrollo [V]. MicroOcpp rebajado a [E]. tzi-OCTT: pytest, 75 casos 1.6J y 252 de 2.0.1 [V]. open-ocpp-tck: 47 escenarios 1.6 y 36 de 2.0.1, drivers para SteVe y CitrineOS [V]. |
| 4.2 Fase 1, punto 3 (onboarding en Pending) | Semántica incompleta: no decía que el cargador no debe enviar requests salvo TriggerMessage, ni qué significa 'interval' cuando el status no es Accepted, ni el comportamiento en Rejected. | Se precisa: en Pending el cargador no envía requests salvo TriggerMessage y nadie cierra el canal; interval = espera mínima antes del siguiente BootNotification (0 → el cargador elige); en Rejected no envía nada hasta vencer el intervalo y cualquiera puede cerrar; tras Accepted se recomienda rechazar TriggerMessage BootNotification hasta el siguiente reinicio [V]. |
| 4.2 Fase 1, punto 4 (referencias open source) | CitrineOS descrito con 'perfiles 0-3' (no verificable) y SteVe sin versiones/transportes. | SteVe: OCPP 1.2/1.5/1.6 en SOAP y JSON, 1.6J con extensiones de seguridad, GPL, MySQL/MariaDB [V]. CitrineOS: 1.6 desde v1.6.0 (abril 2025) y 2.0.1, RabbitMQ, PostgreSQL/PostGIS, en proceso de certificación OCA Core + Advanced Security [V]. |
| 6. Notas de Google Cloud | El timeout del backend service del balanceador estaba marcado [E] y descrito de forma imprecisa ('aplica a la duración de la conexión WebSocket'). | Nueva viñeta verificada: WebSocket activo se cierra a las 24 h (máximo 86.400 s) sin usar el backend timeout; WebSocket inactivo se cierra al vencer el backend timeout (30 s por defecto). Recomendación: subir timeoutSec, ping desde el gateway/WebSocketPingInterval, asumir una reconexión diaria por cargador o usar LB regional/proxy TCP. Cloud Armor y GKE ($0,10/clúster/h, crédito de 74,40 USD/mes) confirmados y marcados como orden de magnitud a confirmar en la calculadora. |
| 8. Fuentes | OCPI 3.0 'objetivo mediados de 2027' presentado como dato; enlaces de Alfen/Kempower/ABB genéricos. | OCPI 2.3.0 21-feb-2025 marcado [V]; OCPI 3.0 'fecha objetivo a confirmar'. Se añadieron fuentes primarias: OCPP 1.6 ed. 2 y errata v4.0 (regulations.gov), tzi.app/Zaptec/libocpp para AuthorizationKey, Alfen (alfen.com y knowledge.alfen.com), Kempower TIP, ABB via be.Energised, Res. 40123 (SUIN Juriscol), RIC N°15 2024 (energia.gob.cl), backend-service de Google Cloud. |

### Puntos añadidos

- **6. Notas de Google Cloud**: Comportamiento del External Application Load Balancer con WebSockets (cierre a las 24 h de conexiones activas, cierre de inactivas al vencer el backend timeout de 30 s por defecto) y las tres medidas operativas: subir timeoutSec, ping periódico y tratar la reconexión diaria + BootNotification como rutina.
- **4.2 Fase 1, punto 3**: Semántica completa de BootNotification Pending/Rejected e 'interval', y obligación del gateway de rechazar el handshake sin subprotocolo ocpp1.6 soportado.
- **2.1 AuthorizationKey**: Formato exacto de la clave (20 bytes / 40 hex), variabilidad entre firmwares y necesidad de que el gateway acepte tanto bytes crudos como representación hex en la cabecera Basic Auth.
- **2.2 ChangeConfiguration con key no estándar**: Aviso de que el cambio de URL suele responder RebootRequired y solo se aplica tras reiniciar/reconectar: planificar el Reset en la misma ventana.
- **3. Pregunta 3 y 4**: Si el certificado OCA es anterior a oct-2025, pedir el certificado de seguridad separado; usar la OCPP Security Operations Guide v1.0 (ene-2026) como guion de preguntas operativas sobre rotación de claves y certificados.
- **3. Pregunta 25 y 7. Decisiones pendientes**: En Colombia la Res. 40123 de 2024 obliga a OCPP (última versión estable) o norma equivalente en estaciones de acceso público, con plazos de 6 meses (nuevas) y 2 años (existentes): un cargador que no pueda apuntarse a un CSMS OCPP incumpliría la norma.
- **4.3 Checklist, ítem 1**: Criterio de aceptación ampliado: rechazo sin subprotocolo ocpp1.6 y política definida ante una segunda conexión con la misma identity.

### Afirmaciones marcadas "a confirmar"

- Fecha exacta de publicación de la 4ª edición del OCPP 1.6 Security Whitepaper (resúmenes indican 5-feb-2026; openchargealliance.org bloqueado).
- Requisito de que la URL OCPP termine en '/' en Teltonika TeltoCharge (wiki y comunidad de Teltonika bloqueadas).
- App 'MyEye' de Alfen como vía alternativa para cambiar el back office.
- Clase de precisión concreta (clase 1) exigida por el RIC N°15 chileno; solo se confirmó la referencia a IEC 62053-21 'o superior'.
- Alcance vigente de la exigencia de OCPP 2.0.1 en NEVI tras la guía interina de agosto de 2025, y si CALeVIP la exige.
- Fecha objetivo de OCPI 3.0 ('mediados de 2027').
- Cifras de precios de Google Cloud (Cloud Armor Standard, GKE 0,10 USD/clúster/h y crédito de 74,40 USD/mes): coinciden con las páginas de precios según resúmenes, pero se dejan como orden de magnitud a confirmar en la calculadora.
- Detalle de que MicroOcpp Simulator sea 'reconocido por operadores de backend' (rebajado a criterio de experiencia).
- Estado de certificación OCA de CitrineOS (Core + Advanced Security) más allá de lo que declara su hoja de ruta.

## A.2 Capítulo 2 (ARQ). Arquitectura del sistema completo y despliegue en Google Cloud

Calificación inicial: 7.5 / 10. Errores corregidos: 19. Puntos añadidos: 8. Afirmaciones marcadas a confirmar: 10.


### Errores corregidos

| Sección | Error detectado | Corrección aplicada |
|---|---|---|
| §6.2 DDL inicial — sessions.meter_value | PRIMARY KEY (session_id, ts, measurand, COALESCE(phase,'')) es inválida: PostgreSQL no admite expresiones en una restricción PRIMARY KEY (error de sintaxis confirmado ejecutando el DDL en PostgreSQL 16). | phase text NOT NULL DEFAULT '' y PRIMARY KEY (session_id, ts, measurand, phase); comentario de que la PK de una tabla particionada debe incluir la clave de partición; ejemplo de creación de partición mensual. El DDL completo ahora ejecuta sin errores. |
| §6.3 Contrato gRPC | El .proto era incoherente: faltaban syntax = "proto3", y los mensajes Empty, GetConnectionRequest, ConnectionInfo y DisconnectRequest referenciados por el servicio no estaban definidos. | Añadidos syntax, package, import google/protobuf/empty.proto y las definiciones de los tres mensajes; nota con los códigos gRPC que la api debe distinguir (NOT_FOUND, DEADLINE_EXCEEDED, UNAVAILABLE, RESOURCE_EXHAUSTED). |
| §3.1 y §3.4 Políticas SSL del ALB | Afirmaba que 'TLS 1.3 exige RESTRICTED' y que las suites TLS_RSA_* 'no están en RESTRICTED' (implicando que sí en MODERN). Las versiones mínimas configurables son 1.0/1.1/1.2 (no se puede fijar 1.3); TLS 1.3 se negocia si el cliente lo soporta; FIPS_202205 exige mínimo 1.2; las suites RSA sin ECDHE sólo están en COMPATIBLE o CUSTOM. | Reescrito: perfiles incluyendo CUSTOM, mínimos 1.0-1.2, y advertencia de que muchos cargadores 1.6 sólo negocian TLS_RSA_* (suites del whitepaper 1.6/PICS OCA), por lo que MODERN/RESTRICTED pueden impedirles conectar; recomendación de perfil CUSTOM con las cuatro suites y prueba con cargador real. Añadido riesgo en §9 y check en §8.1. |
| §3.4 Cipher suites | Atribuía la lista de suites TLS a la 'guía de operaciones de seguridad de la OCA'; la lista proviene del OCPP 1.6 Security Whitepaper y de los PICS de certificación 1.6 publicados por la OCA. | Atribución corregida y marcada [V]; nota sobre necesidad de certificado RSA del servidor para suites RSA. |
| §3.1 / §3.4 / §9 mTLS y revocación | Decía 'confianza media; verificar' sobre si el LB comprueba revocación. | Confirmado: el ALB no realiza comprobaciones de revocación (ni CRL ni OCSP) y el trust config no admite CRL; CA Service sólo emite CRL. Texto actualizado y marcado [V]; mitigación con huellas/seriales revocados y certificados de vida corta. |
| §5.1 ocpp-rpc | Fecha de publicación de npm 2.2.1 indicada como '~julio 2026'; en realidad fue el 17 de julio de 2025 (2.2.0 en enero de 2025). | Fecha corregida; confirmado que incluye validadores/esquemas para ocpp1.6, ocpp2.0.1 y ocpp2.1 (URN OCPP:Cp:2:2025:1) y perfiles 1-3; nota de que package.json declara Node ≥ 17.3 aunque el README pida ≥ 20. |
| §5.1 Java-OCA-OCPP | Afirmaba soporte multi-protocolo 1.6/2.0.1/2.1 en v2.0; las notas de release sólo anuncian 1.6S, 1.6J y OCPP 2 (2.0.1); 2.1 no aparece. | Columna OCPP soportado cambiada a '1.6, 2.0.1 (2.1 a confirmar)' y descripción ajustada. |
| §5.1 SteVe / Powerfill | 'SteVe validado indirectamente por la certificación OCA de Powerfill' era impreciso: el certificado OCA.0016.1261.CSMS (julio 2026) cubre el backend de Powerfill (que incorpora SteVe), no a SteVe como distribución. | Redacción precisa con el número de certificado y alcance real. |
| §5.2 SteVe (avisos de seguridad) | Hablaba de 'CVE corregido en 3.14.1' sin identificar; hay dos avisos distintos: CVE-2026-28230 (comprobación de propiedad del chargeBoxId en StopTransaction, corregido en 3.12.0) y GHSA-67fq-r6rm-rqpm (validación del idTag en StopTransaction, corregido en 3.14.1); además la unicidad de messageId es de 3.12.0 (marzo 2026). | Los tres identificados con versión y fecha, marcados [V], y señalados como fallos a evitar en el CSMS propio. |
| §5.2 EVerest | Datos incompletos: libocpp archivado (fecha) y versiones de release. | libocpp archivado el 27-04-2026 e integrado en EVerest; releases 2026.02.0 (26-03-2026) y 2026.02.1 (21-07-2026); 2.1 en desarrollo. Marcado [V]. |
| §5.3 Recomendación (2.0.1 obligatorio) | '2.0.1 obligatorio en licitaciones y en el EU AFIR/NEVI' es una generalización no sustentada (AFIR no impone OCPP 2.0.1 de forma explícita). | Suavizado: 'exigido o previsto en programas públicos como NEVI y cada vez más en licitaciones; depende del país (a confirmar)'; añadido que OCPP 2.0.1 ed.3 es IEC 63584:2024 y OCPP 2.1 ed.1 es IEC 63584-210:2025 [V]. |
| §3.2 / §3.4 ALB regional como alternativa al corte de 24 h | Se presentaba un ALB regional como forma de evitar el cierre de WebSockets activos a las 24 h; varias fuentes indican que el límite aplica a todos los ALB. | Marcado 'a confirmar' y se indica no diseñar contando con ello; la alternativa firme es un External proxy Network LB (TCP passthrough). Añadido rango del backend timeout (1-2.147.483.647 s) y que GCPBackendPolicy.timeoutSec lo admite [V]. |
| §3.3 y §4.4 reconexión de cargadores | 'todos los firmwares 1.6J lo hacen' (reconectar solos) es una sobregeneralización no verificable. | Reescrito como comportamiento esperado de un cliente OCPP-J cuyo backoff y tolerancia al código 1012 dependen del firmware y deben medirse con la unidad piloto. |
| §3.1 Cloud Armor | Se decía que Cloud Armor 'evalúa la request de upgrade' sin aclarar que no inspecciona nada después. | Precisado [V]: sólo se evalúa la request de upgrade; los mensajes posteriores del canal WebSocket no se inspeccionan. |
| §4.2 Opción B (gRPC directo al pod) | Mencionaba 'Service headless' como mecanismo de direccionamiento desde Cloud Run, pero el DNS de un Service headless sólo resuelve dentro del clúster. | Aclarado que en un clúster VPC-native (Autopilot siempre lo es) las IPs de pod son enrutables en la VPC [V], la api llama a podIp:9090 leído del registro Redis, y hace falta regla de firewall desde la subred de Direct VPC egress al rango de pods. |
| §2.4 nota de sincronía OCPP-J | Cita '§4.1' con 'confianza media'. | Referida a la sección 'Synchronicity' §4.1.1 de OCPP-J 1.6, con número de sección marcado a confirmar contra el PDF de la OCA. |
| §7 supuestos de precios | Presentaba como 'tarifas verificadas' cifras no confirmadas (Memorystore Standard M1 0,064 $/GiB-h) y BigQuery 0,02 $/GiB-mes (lista actual ≈ 0,023). | Separadas las cifras contrastadas [V] de las estimaciones (Memorystore Standard, ALB, NAT); BigQuery 0,02-0,023; añadido Cloud Logging 0,50 $/GiB tras 50 GiB; todo el cuadro marcado como orden de magnitud a recalcular. |
| D5, §3.5 Cloud SQL/AlloyDB | 'AlloyDB ~39 % más caro' y 'Enterprise Plus +30 %' presentados como hechos. | Marcados como estimación con precios de lista (a confirmar en la calculadora); añadidos precios de lista de AlloyDB de fuente secundaria. |
| Nota de verificación (cabecera) | La nota describía bloqueos de red de la sesión de trabajo, contenido ajeno a un documento de diseño. | Reescrita como nota neutra sobre el significado de las marcas [V] y (a confirmar) y el carácter de lista/orden de magnitud de todos los precios. |

### Puntos añadidos

- **§3.5 Pub/Sub**: Límites que condicionan el diseño de eventos: 1 MB/s de publicación por ordering_key [V] (suficiente con ordering_key = chargeBoxId), mensaje máximo 10 MB, publicar desde la misma región y reanudar publicación tras fallo con ordenación activa; precio de suscripciones BigQuery 50 $/TiB.
- **§3.4 y §8.1 TLS con cargadores reales**: Prueba obligatoria de handshake TLS con un cargador real contra MODERN/RESTRICTED; fallback a perfil CUSTOM con las cuatro suites del whitepaper 1.6; verificar que el cargador confía en la raíz (Google Trust Services) del certificado gestionado o instalarla; certificado RSA del servidor.
- **§4.2 y §8.1 Red interna api → gateway**: Regla de firewall VPC desde la subred de Direct VPC egress de Cloud Run al rango de pods (puerto 9090) y NetworkPolicy en el clúster; explicación de por qué el registro guarda IP de pod y no nombre DNS.
- **§6.2 DDL**: Creación anticipada de particiones (ejemplo mensual y mención a pg_partman), CHECK de message_type (2/3/4) e índice (charge_box_id, ts DESC) en ocpp_message_log.
- **§6.3 gRPC**: Mensajes faltantes del contrato y semántica de errores gRPC que la api debe distinguir.
- **§8.1 Operación del primer mes**: Presupuestos con alertas 50/80/100 % por proyecto; ventana de mantenimiento de Cloud SQL fuera del horario de carga; prueba de restauración de backup/PITR en staging antes del primer cargador; job de creación de particiones con alerta; política de maxmemory de Redis y TTL del registro de conexiones; manejo de BootNotification Pending/Rejected y de Heartbeat.conf.currentTime como fuente de hora.
- **§9 Riesgos**: Nuevo riesgo: cargadores que sólo negocian suites TLS_RSA_* (sin ECDHE) no pueden conectar con perfil MODERN/RESTRICTED; mitigación con perfil CUSTOM limitado a ocpp.<dominio> y exigencia de firmware con ECDHE al proveedor. Riesgo mTLS actualizado con la confirmación de que el ALB no consulta CRL/OCSP.
- **§3.5 Observabilidad**: Precio de Cloud Logging (50 GiB/mes gratis por proyecto, ≈ 0,50 $/GiB) para cuantificar el riesgo de coste de logs.

### Afirmaciones marcadas "a confirmar"

- Precio de Memorystore for Redis Standard tier M1 en us-central1 (fuentes secundarias oscilan entre 0,064 y 0,098 $/GiB-h); marcado (a confirmar) en §7 y §10.
- Que un ALB regional evite el cierre de WebSockets activos a las 24 h (varias fuentes indican que el límite aplica a todos los ALB); marcado (a confirmar) en §3.2 y §3.4.
- Tabla exacta de cipher suites por perfil SSL (MODERN/RESTRICTED sin TLS_RSA_*): coherente con el CIS GCP Benchmark 3.9 y con resúmenes de la doc, pero no se pudo leer la tabla oficial (docs.cloud.google.com bloqueado); marcado (a confirmar).
- Sobrecoste de Cloud SQL Enterprise Plus (+30 %) y de AlloyDB (+39 %): sólo fuentes secundarias (Bytebase); marcados como estimación.
- Soporte de OCPP 2.1 en Java-OCA-OCPP v2.0 (no anunciado en las notas de release); marcado (a confirmar).
- Número de sección 'Synchronicity' de OCPP-J 1.6 (§4.1.1): openchargealliance.org bloqueado; marcado (a confirmar).
- Número de la ley chilena de protección de datos (Ley 21.719): marcado (a confirmar).
- Ediciones exactas de esquemas en la librería Python ocpp ('1.6 errata v4 y 2.0.1 ed. 3'): marcado (a confirmar).
- Exigencia de OCPP 2.0.1 por país/programa (AFIR/NEVI/licitaciones): reescrito como dependiente del país, a confirmar.
- Precios de ALB y Cloud NAT en §7: se mantienen como aproximación.

## A.3 Capítulo 3 (FUN). Alcance funcional y catálogo de parámetros configurables

Calificación inicial: 8.2 / 10. Errores corregidos: 12. Puntos añadidos: 7. Afirmaciones marcadas a confirmar: 6.


### Errores corregidos

| Sección | Error detectado | Corrección aplicada |
|---|---|---|
| M10 Monitoreo — catálogo de alarmas | Se citaba `FirmwareMismatch` como tipo de SecurityEventNotification; ese tipo no existe en el Security Whitepaper ni en OCPP 2.0.1. | Sustituido por `InvalidFirmwareSignature` y añadida la lista completa de los 18 tipos del whitepaper (contrastada con los enums de referencia). |
| M02 flujo de registro (diagrama) y CU-01 paso 5 | `TriggerMessage(StatusNotification, connectorId=0)` se presentaba como forma de obtener el estado de todos los conectores; con connectorId=0 el cargador solo devuelve el estado global del cargador. | Cambiado a `TriggerMessage(StatusNotification)` sin connectorId (la especificación lo interpreta como 'para todos los conectores'); nota añadida en la fila TriggerMessage de §3. |
| M05 modelo de tarifa (JSON) y CU-06 | El JSON 'alineado a OCPI 2.2.1' usaba `valid_from`, campo inexistente en OCPI; faltaban los obligatorios `country_code`, `party_id`, `last_updated`. | JSON corregido con `start_date_time`/`last_updated`/`country_code`/`party_id`; explicado que las restricciones horarias se interpretan en la zona horaria de la sede y que end_time < start_time envuelve la medianoche; CU-06 actualizado. |
| M17 Roaming OCPI | La lista de Commands omitía `CANCEL_RESERVATION`; Payments y Booking se describían como módulos incluidos en el núcleo 2.3.0. | Añadido `CANCEL_RESERVATION`; 2.3.0 descrito como núcleo + módulos opcionales Payments y Bookings empaquetados aparte (ramas del repo oficial), con el detalle real de los cambios del núcleo (Parking/tipos de vehículo, contratos eMSP por EVSE, teléfono de soporte y accesibilidad para AFIR/NAP, impuestos norteamericanos, señales ISO 15118, extensibilidad). |
| M08 Reservas | 'OCPI 2.3.0 añade módulo Booking' sin matiz; y no se advertía que en 1.6 el cargador no notifica la expiración de la reserva. | Matizado como módulo opcional aparte; añadido que en 1.6 el CSMS debe llevar su propio temporizador de expiración (ReservationStatusUpdate solo existe en 2.0.1). |
| M02 nota Google Cloud | 'Cloud Run limita cada request WebSocket a 60 minutos (por defecto 5)' era correcto pero incompleto: faltaba el cierre de WebSockets activos a las 24 h y de inactivos por backend timeout en el balanceador externo (verificado por el orquestador) y la afinidad best effort. | Nota reescrita con los tres límites (Cloud Run 5/60 min y 1.000 requests concurrentes máx.; ALB 24 h activos / backend timeout inactivos; afinidad best effort) y la consecuencia funcional (al menos una reconexión diaria por cargador, ping por debajo del timeout). |
| M21 y §5 — AuthorizationKey | Se afirmaba longitud 'hex 16–40 B' / '16–40 bytes' como dato del whitepaper; no pude confirmar el máximo (las fuentes accesibles hablan de mínimo 16 bytes y de representación hex de 40 caracteres = 20 bytes). | Reescrito como 'mínimo 16 bytes, representación hexadecimal; máximo a confirmar en la edición vigente del whitepaper'; ejemplo de rotación cambiado a 20 bytes (40 hex). |
| §2.2 DDL — tabla config_param | `UNIQUE (key, scope_type, scope_id, valid_from)` con `scope_id` NULL para PLATFORM no impide duplicados en PostgreSQL (NULLs se consideran distintos). | Cambiado a `UNIQUE NULLS NOT DISTINCT (...)` (PostgreSQL ≥ 15) con comentario sobre índice parcial para versiones anteriores. |
| M09 Smart charging | Comportamiento de ChargePointMaxProfile/TxDefaultProfile/TxProfile marcado como 'Verificado' sin fuente primaria accesible. | Rebajado a 'según la especificación 1.6 (confianza media, fuente primaria no accesible)'; el contenido en sí es coherente con la especificación. |
| M07 Idle fee — cabecera de parámetros | 'prácticas de mercado verificadas: gracia 5–15 min, 0.40–0.50 USD/min' presentaba un rango genérico como verificado. | Sustituido por la referencia verificable (Tesla Supercharger 2025: gracia 5 min, ≈0,50 USD/min solo si la estación está ≥50 % ocupada, ×2 al 100 %) y el resto marcado como orientativo a confirmar por país; referencia OCA de precios actualizada (existe v3.1, sep-2024). |
| §3 fila DataTransfer PnC | Lista incompleta de mensajes envueltos y estado de verificación del vendorId ambiguo. | Añadidos InstallCertificate, DeleteCertificate, GetInstalledCertificateIds, TriggerMessage; vendorId marcado explícitamente 'a confirmar en el whitepaper'. |
| §11 Referencias | StEVe descrito como 'GPL-3.0, OCPP 1.2–1.6'; imprecisiones menores en referencias de Cloud Run. | StEVe: licencia GPL, OCPP 1.2/1.5/1.6 en SOAP y JSON + extensiones de seguridad 1.6J [V]; referencias de Cloud Run/ALB desglosadas; añadidas referencias a la guía de operaciones de seguridad OCA (ene-2026), al nuevo programa de certificación 1.6 (oct-2025), al repo OCPI 2.2.1/2.3.0. |

### Puntos añadidos

- **M02 Gateway OCPP (comportamiento) + parámetro 'Umbral OFFLINE' + M10 alarma OFFLINE + 10.1**: Heartbeat implícito: la especificación permite al cargador omitir Heartbeat cuando envió otro mensaje en el intervalo y pide al Central System considerar vivo al cargador con cualquier PDU. El detector OFFLINE debe reiniciarse con cualquier mensaje; se añadió criterio de aceptación para evitar falsas alarmas OFFLINE durante cargas largas.
- **M02 Gateway OCPP**: Regla de tiempo: OCPP recomienda UTC; el CSMS responde currentTime en UTC y almacena en timestamptz; la zona horaria de la sede solo para franjas tarifarias, horarios y presentación (enlazado con M05: convertir lecturas UTC a hora local antes de repartir energía por franja).
- **M21 Seguridad OCPP**: Checklist del primer mes para perfil 2: CA raíz que el firmware acepta, hostname exacto en el certificado, TLS 1.2 mínimo, y orden seguro de migración (escribir AuthorizationKey por el canal vigente antes de cambiar SecurityProfile) para no dejar el cargador incomunicado; usuario Basic Auth = chargeBoxId; referencia al programa de certificación OCA vigente (SP2 + Firmware Management en Core desde oct-2025) y a la guía de operaciones de seguridad (ene-2026).
- **M03 Autorización — Autocharge y Plug&Charge**: Limitaciones prácticas: Autocharge solo con comunicación de alto nivel (DC/CCS o AC con ISO 15118), MAC no autenticada (riesgo de suplantación, usar solo con conductor registrado y pago vinculado); Plug&Charge exige PKI ISO 15118 (proveedor de PKI o acuerdo de roaming), no viable en solitario para un CPO pequeño.
- **M04 Sesiones**: Valores completos de TxStartPoint/TxStopPoint de 2.0.1 (Authorized, DataSigned, EnergyTransfer, EVConnected, ParkingBayOccupancy, PowerPathClosed).
- **§5 Catálogo de keys**: Nota explícita de que las 56 keys de la tabla existen todas en 1.6/Security Whitepaper/whitepaper ISO 15118 y que las keys de URL del Central System (CentralSystemURL, BackOfficeURL…) son propietarias y van en la tabla de DataTransfer/keys propietarias de M02.
- **10.1 Criterios de aceptación**: Prueba previa con simulador de cargador OCPP 1.6J (cortes de red y mensajes duplicados) antes de tocar hardware real.

### Afirmaciones marcadas "a confirmar"

- Longitud máxima exacta de `AuthorizationKey` en el Security Whitepaper de OCPP 1.6 (mínimo 16 bytes confirmado por fuentes secundarias; el máximo queda '(a confirmar)'; openchargealliance.org bloqueado por el proxy).
- `vendorId` exacto `org.openchargealliance.iso15118pnc` del whitepaper 'Using ISO 15118 Plug & Charge with OCPP 1.6' (solo evidencia secundaria; marcado 'a confirmar en el whitepaper').
- Rangos genéricos de idle fee de otras redes (gracia 5–15 min, topes por sesión): solo Tesla pudo verificarse; el resto quedó como orientativo a confirmar por país.
- Reglas de SetChargingProfile (ChargePointMaxProfile solo en connectorId 0, TxProfile se borra al terminar, stackLevel mayor prevalece): coherentes con la especificación pero sin fuente primaria accesible; marcadas como confianza media.
- Accesibilidad (R/RW) y obligatoriedad de cada configuration key en §5: la existencia de todas las keys está verificada con los enums de referencia; R/RW/obligatoriedad siguen siendo 'confianza media' (texto de la especificación no accesible).
- Afirmación de M06 de que OCPP 2.1 añade pago ad hoc en el cargador: consistente con los anuncios de OCA ('nuevas opciones de autorización') pero no confirmada en detalle.

## A.4 Capítulo 4 (TAR). Motor de tarifas y precios dinámicos

Calificación inicial: 8 / 10. Errores corregidos: 14. Puntos añadidos: 6. Afirmaciones marcadas a confirmar: 9.


### Errores corregidos

| Sección | Error detectado | Corrección aplicada |
|---|---|---|
| 1.5 DDL — tabla pricing_rule | `id UUID PRIMARY KEY` junto con `UNIQUE (id, version)` hace imposible versionar una regla (dos versiones de la misma regla necesitarían el mismo id, que es la PK); contradice el ejemplo JSON de §2.2 (`id: rule-occupancy-peak, version: 3`) y el flujo DRAFT→ACTIVE→RETIRED. | Una fila por versión: se añade `rule_id TEXT NOT NULL` (identidad estable) y la restricción pasa a `UNIQUE (tenant_id, rule_id, version)`; comentario explicando el motivo. |
| 1.5 DDL — tariff_version | Una versión SCHEDULED/ACTIVE podía tener `valid_from NULL`, lo que la deja fuera del EXCLUDE de solape y de la resolución de vigencia. | CHECK (status = 'DRAFT' OR valid_from IS NOT NULL). Se aclara además que `app_rw` es el rol de la aplicación y debe existir antes del REVOKE. |
| 4 — tabla OCPP 2.0.1, totalCost | Decía que `totalCost` omitido = 'costo desconocido'. La semántica de la spec es distinta: si se omite, la transacción NO fue gratuita (el CSMS simplemente no comunica costo y el cargador usa TotalCostFallbackMessage); 0.00 = gratuita. | Redactada la semántica correcta, con la moneda de `TariffCostCtrlr.Currency`; se añaden las instancias Tariff/Cost de Enabled/Available y `OfflineTariffFallbackMessage` (verificado en TariffCostCtrlr.json de libocpp). |
| 1.1 — herramientas existentes | Presentaba CitrineOS-OCPI y su `calculateTotalCost` como referencia de cálculo; en el código actual es un `kWh × precio` (floor a 2 decimales) con un TODO para tarifas OCPI completas. | Se mantiene como implementación del módulo Tariffs CPO 2.2.1 pero se indica que NO sirve como oráculo; `ocpi-tariffs` (Rust, crates.io, CLI `price -c cdr -t tariff`, calcula en 2.2.1 y convierte 2.1.1) queda como único oráculo. |
| 1.1 y 9 — referencias a EVerest/libocpp | Citaba `EVerest/libocpp` como repositorio vigente; fue archivado (deprecation notice, abril de 2026) y el código está en el monorepo `EVerest/EVerest` bajo `lib/everest/ocpp/`. La issue #706 (California Pricing para 2.0.1) no está 'pendiente': se cerró con el archivo y 2.0.1 está implementado. | Actualizadas las rutas y el estado en §1.1, §4 y §9 (incl. `doc/common/california_pricing_requirements.md`, `known_keys.hpp`, `CostAndPrice.json`). |
| 0.5, 4 y 8 — extensión California Pricing | Las configuration keys estaban incompletas/ambiguas: solo `CustomDisplayCostAndPrice` y `DefaultPrice`; no se decía que `CustomDisplayCostAndPrice` es de solo lectura (se descubre con GetConfiguration), ni existían `DefaultPriceText,<idioma>`, `NumberOfDecimalsForCostValues`, `CustomIdleFeeAfterStop`, `SupportedLanguages`, `TimeOffset`; tampoco cómo viaja la extensión en 2.0.1. | Verificado en código (EVerest v16 known_keys.hpp, CostAndPrice.json, pruebas ocpp16/ocpp201): vendorId `org.openchargealliance.costmsg`, messageIds SetUserPrice/RunningCost/FinalCost, keys completas, nota de la corrección v3.0→v3.1 (`DefaultPrice`→`DefaultPriceText`), en 2.0.1 va en `customData` de CostUpdated/TransactionEventResponse y se anuncia con `CustomizationCtrlr.CustomImplementationEnabled` instancia `org.openchargealliance.costmsg`. PR #1020 de CitrineOS: fusionado el 14-09-2026 en la rama `next` (no necesariamente en release). |
| 1.1 — nota de versión OCPI | Fecha '21-02-2025' de OCPI 2.3.0 no confirmada (solo 'febrero 2025'); no se explicaba que `tax_included` (TaxIncluded) es campo obligatorio en 2.3.0 ni que omitir `vat` ≠ `vat = 0` en 2.2.1. | Fecha reescrita como 'febrero de 2025 (día exacto a confirmar)'; añadidos ambos matices, verificados en `mod_tariffs.asciidoc` de master y de release-2.2.1-bugfixes. |
| 1.1 — tabla TariffRestrictions | Faltaban precisiones de la spec: `start_date`/`min_kwh`/`min_duration` inclusivos, `max_duration` exclusivo, corriente en A (suma de fases), `end_time = 00:00` para fin de día, valores de `day_of_week`. | Completado con el texto verificado de OCPI 2.2.1. |
| 1.1 — mapeo OCPI→OCPP 2.1 | Mapeo incompleto: `PARKING_TIME→idleTime` y `FLAT→fixedFee` sin el campo de precio; faltaban `TariffConditionsFixed{paymentBrand, paymentRecognition}` y `TaxRate{type, tax, stack}`. | Mapeo completo verificado en `ocpp_types.hpp` (priceKwh/priceMinute/priceFixed, vat→taxRates[]). |
| 4 — tabla OCPP 2.1 | Mensajes de tarifa sin sus respuestas/estructuras; `CostDetails` sin `failureReason`. | Añadidos `TariffSetStatusEnum`, `TariffChangeStatusEnum`, `GetTariffs → tariffAssignments[]`, `ClearTariffs(tariffIds[]?, evseId?) → clearTariffsResult[]`, `failureReason` y `updatedPersonalMessageExtra[]` (verificado en headers v21). |
| 1.2 — extensiones x_volt | Afirmaba que `grace_period_s` 'equivale' a `TariffConditions.minIdleTime`; minIdleTime es una condición de aplicabilidad de un precio, no una gracia explícita. | Reescrito como aproximación, con la aclaración. |
| 5 — regulación | AFIR marcado 'confianza media' (orden kWh→minuto→sesión, fechas 13-04-2024 y 1-1-2027, art. 20 desde 14-04-2025) y sin la obligación DATEX II; Colombia/Chile/México sin fechas ni marcas de verificación. | Confirmado con varias fuentes coincidentes y el whitepaper OCA 'AFIR and OCPP': marcado [V]; añadido DATEX II obligatorio desde 14-04-2026, QR insuficiente en ≥ 50 kW, terminal compartido por pool; Res. MME 40123 del 9-04-2024 (condiciones de interoperabilidad); DS 12/2022 publicado 17-05-2022 y vigente 18 meses después, registro del cargador en 30 días; clave SAT 83101800 existente en el catálogo v4.0. |
| 7.3 — nota Cloud Run | Límite de 3600 s marcado 'confianza media, documentación no descargable'. | Marcado [V] conforme a la documentación oficial (5 min por defecto, 60 min máximo, afinidad best effort) y a las verificaciones previas; reforzada la conclusión gateway en GKE / pricing en Cloud Run. |
| 3.3, 3.7, 9 — redacción | Frases que aludían a descargas fallidas 'en esta sesión'. | Neutralizadas: '(a confirmar con la pasarela)', 'contrastado con fuentes secundarias y keys estándar', enlaces directos a los PDF de OCA (California Pricing v3.1 y Signed Meter Values v1.0). |

### Puntos añadidos

- **6.3 Casos de prueba**: T11 fail-closed sin asignación de respaldo (Quote y RemoteStart rechazados con NO_TARIFF), T12 precio con impuesto incluido (neto + impuesto == bruto exactamente), T13 lecturas en kWh normalizadas a Wh.
- **7.4 Endpoints y validaciones**: `POST /v1/sessions/{id}/cost:adjust` (ajuste manual por cortesía/disputa como línea ADJUSTMENT auditada; nota de crédito si ya hay factura); validaciones: `grace_period_s` obligatorio si hay PARKING_TIME y `currency` igual a la del country_profile de la sede.
- **8 Checklist**: Nuevo bloque 'Checklist del primer mes de operación (tarifas)': country_profile antes de la primera tarifa, validate + simulate con 3 escenarios, verificar unidad Wh/kWh y meterStop−meterStart vs suma de muestras en 20 sesiones, revisar flags METER_ANOMALY/CLOCK_SKEW/RECONCILED_TO_STOP, observar Finishing/SuspendedEV antes de activar idle fee, pruebas de hold/captura/expiración en sandbox, tarifa INTERNAL a 0 separada de la pública, 10 sesiones contra ocpi-tariffs como fixtures, cuatro ojos y aviso mínimo.
- **8 Preguntas al proveedor (pregunta 5)**: Cómo descubrir el soporte de California Pricing: GetConfiguration de CustomDisplayCostAndPrice debe devolver true; keys DefaultPrice/DefaultPriceText.
- **5 Regulación UE**: Obligación de datos dinámicos (precio ad hoc, disponibilidad) al National Access Point y formato DATEX II desde 14-04-2026; pantalla obligatoria solo en ≥ 50 kW.
- **4 OCPP 2.0.1**: Cómo se transporta California Pricing en 2.0.1 (customData + CustomizationCtrlr.CustomImplementationEnabled) para no depender de DataTransfer al migrar de hardware.

### Afirmaciones marcadas "a confirmar"

- Día exacto de publicación de OCPI 2.3.0 (solo confirmado 'febrero de 2025'); quedó '(a confirmar)'.
- Campos finos de RunningCost en California Pricing v3.1: `idlePrice{graceMinutes, hourPrice}`, `nextPeriod`, `triggerMeterValue` (openchargealliance.org bloqueado; verificados solo transactionId/timestamp/meterValue/cost/state/chargingPrice y FinalCost via código EVerest/CitrineOS); quedó '(a confirmar contra el PDF)'.
- Detalle de campos de la nota 'Signed Meter Values in OCPP' v1.0 (fecha y alcance 1.6/2.0.1/2.1 confirmados; campos 'a confirmar contra el PDF').
- Plazo de ≤ 1 minuto para actualizar datos dinámicos (precio ad hoc, disponibilidad) en el NAP bajo AFIR art. 20 (fuente secundaria; marcado 'a confirmar').
- Autorización incremental (ampliar el hold) en la pasarela de pago: depende de pasarela/red/emisor; marcado 'a confirmar con la pasarela elegida'.
- Detalle de Eichrecht (facturación por tiempo con medición de tiempo conforme): se mantiene 'confianza media'.
- Uso de `transactionId = -1` en MeterValues por algunos firmwares antes de StartTransaction.conf: sigue 'a verificar con el proveedor'.
- Que la clave SAT 83101800 sea la correcta para el servicio de recarga (existe en el catálogo; aplicación fiscal a confirmar con contador).
- Que OCPP 2.1 'se diseñó alineado con OCPI' (afirmación de la OCA, no contrastada con el texto de la spec 2.1; las estructuras verificadas son muy parecidas pero no idénticas: 2.1 tarifa el tiempo por minuto).

## A.5 Capítulo 5 (SEG). Seguridad integral

Calificación inicial: 7.5 / 10. Errores corregidos: 12. Puntos añadidos: 9. Afirmaciones marcadas a confirmar: 9.


### Errores corregidos

| Sección | Error detectado | Corrección aplicada |
|---|---|---|
| §2.7 PKI propia con Certificate Authority Service | Precio de CAS: se afirmaba 'USD 0,30 por certificado en el primer tramo' y que la cuota mensual no estaba verificada; además se concluía que con raíz + 3 subordinadas era 'un coste marginal'. | Precios verificados: DevOps USD 20/CA/mes + 0,30/cert; Enterprise USD 200/CA/mes + 0,50/cert (tramo 0-50.000). El diseño con 4 CAs Enterprise costaría ≈ USD 800/mes fijos; se recomienda una sola subordinada Enterprise en CAS, raíz offline externa y certificado de servidor desde Certificate Manager cuando el firmware traiga la raíz pública. |
| §2.6 Terminación TLS en GCP (revocación) y §2.7 | La no comprobación de revocación en el ALB se presentaba como 'confianza media: verificar'. | Confirmado: el ALB no realiza comprobaciones de revocación de certificados de cliente (el TrustConfig no admite CRL); la comparación de huella/serial en el gateway es el bloqueo real; se añaden vidas cortas y rotación de CA/TrustConfig como complemento. |
| §1.2 Evidencia reciente | El paper arXiv 2404.06635 'Current Affairs' se describía como una medición de '~1.000 endpoints OCPP en 56 países, ~720 sin cifrado'. El paper es una medición de estaciones DC CCS físicamente desplegadas (USENIX Security 2025) sobre TLS en el enlace ISO 15118, no de backends OCPP en Internet. | Descripción reescrita con el contenido real del paper; la cifra exacta de estaciones sin TLS (≈84 %) se marca '(a confirmar)'. |
| §4 Pagos — PCI DSS v4.0.1 SAQ A | Se decía que el comerciante debe 'confirmar protección contra ataques por scripts (req. 6.4.3 y 11.6.1)'. En realidad la versión de SAQ A de enero de 2025 eliminó 6.4.3, 11.6.1 y 12.3.1 del cuestionario y añadió un criterio de elegibilidad sobre susceptibilidad a scripts. | Redacción corregida: anuncio del 30-ene-2025, vigencia 31-mar-2025, requisitos eliminados y nuevo criterio de elegibilidad; las técnicas de 6.4.3/11.6.1 o la confirmación del proveedor son formas de cumplirlo. |
| §2.2 tabla de claves de configuración | `SupportedFileTransferProtocols` figuraba como 'requerida por el whitepaper' y verificada en el Security.json de libocpp; no está en ese esquema ni en la lista de claves del whitepaper. | Se indica que procede de la errata v4.0 de OCPP 1.6 (a confirmar) y que no aparece en Security.json de libocpp. |
| §2.1 tabla de perfiles (fila 0) | Perfil 0 descrito como 'no definido en el whitepaper'. | Reformulado como estado sin protección (ws:// sin autenticación), valor por defecto de SecurityProfile en libocpp cuyo esquema admite 0-3 [V]. |
| §2.6 tabla (política de suites) | RESTRICTED descrito como 'sólo ECDHE+AES-GCM' y no se advertía que la SSL policy por defecto del ALB es COMPATIBLE con TLS 1.0. | Perfiles COMPATIBLE/MODERN/RESTRICTED/CUSTOM descritos según la documentación (RESTRICTED incluye CHACHA20; CUSTOM no afecta a TLS 1.3); se advierte que la política por defecto es COMPATIBLE + TLS 1.0 y se recomienda CUSTOM con TLS ≥ 1.2; lista exacta de suites marcada (a confirmar). |
| §3.1 Identidad — precios Identity Platform | Tramos incompletos ('0,0055→0,0025') y SAML/OIDC sin tramo gratuito. | Tramos completos verificados (0-49.999 gratis; 0,0055; 0,0046; 0,0032; 0,0025), SAML/OIDC gratis hasta 49 MAU y 0,015 desde 50, SMS 0,01-0,46 con 10/día gratis; TOTP GA, blocking functions y multi-tenant sin coste adicional. |
| §2.2 tabla de mensajes | No se distinguía qué campos son obligatorios u opcionales en GetLog y SignedUpdateFirmware. | `remoteLocation` obligatorio y timestamps opcionales en GetLog; `retrieveDateTime` obligatorio e `installDateTime` opcional en SignedUpdateFirmware (esquemas mobilityhouse 2020:3). |
| §5 Datos personales — Chile 21.719 | Se afirmaba 'notificación de brechas en 72 h' sin fuente. | Se mantiene lo verificado (publicación 13-dic-2024, vigencia 1-dic-2026, Agencia, multas hasta 20.000 UTM y 4 % en reincidencia) y el plazo de notificación se marca '(a confirmar en el reglamento)'. |
| §6.3 Binary Authorization / Artifact Analysis | 'gratis en Cloud Run' y 'USD 0,26 por imagen' sin verificar; no se indicaba que los re-escaneos son gratuitos. | Confirmado: sin coste en Cloud Run; GKE USD 0,01613/clúster/h con crédito de USD 12/mes por cuenta de facturación; Artifact Analysis USD 0,26 por primer escaneo, re-escaneos sin coste. |
| §10 Fuentes | Varias filas figuraban como 'parcial' o 'no verificado' pese a poder confirmarse (CISA/CVE, cabeceras mTLS, CAS, Identity Platform, issue #2553); faltaban filas para los esquemas JSON y libocpp. | Tabla actualizada con el estado real de verificación, filas nuevas (CVE-2026-28230, esquemas mobilityhouse, libocpp Security.json, timeouts del ALB/Cloud Run) y una fila explícita de lo no verificable. |

### Puntos añadidos

- **§2.5 Controles en ocpp-gateway (control 11 nuevo) + §0 S1 + §1.2 + §8 P0**: Propiedad de la transacción: resolver StopTransaction/MeterValues/RemoteStopTransaction por (charge_point_id, transactionId) y no sólo por transactionId; transactionId no secuencial ni global. Motivado por CVE-2026-28230 (SteVe ≤ 3.11.0, corregido en 3.12.0), que permitía a cualquier cargador cerrar sesiones ajenas.
- **§2.6 Notas + §8 P0**: Tiempos de vida del WebSocket en el ALB global (activo ≤ 24 h; inactivo cae al backend service timeout, 30 s por defecto) y en Cloud Run (request timeout máx. 60 min, afinidad best effort): configurar timeoutSec > intervalo de ping, tratar la reconexión diaria como evento normal y no como DuplicateConnection, y no dejar la SSL policy por defecto (COMPATIBLE/TLS 1.0).
- **§2.6 tabla (qué ve el gateway)**: El gateway debe eliminar/ignorar las cabeceras client_cert_* si llegan por un camino distinto del ALB; las cabeceras se rellenan sólo si el certificado valida o en modo ALLOW_INVALID_OR_MISSING_CLIENT_CERT.
- **§2.4 Eventos de seguridad**: Filas para CsrGenerationFailed (bloquea Profile 3 en ese modelo) y MaintenanceLoginAccepted/Failed (acceso local de mantenimiento; correlacionar con órdenes de campo), presentes en libocpp.
- **§2.1**: Nota de mercado: desde octubre de 2025 la certificación OCPP 1.6 de la OCA exige Security Profile 2 y Firmware Management en Core; usar como vara mínima ante el proveedor.
- **§3.2 Autorización**: Cómo respetar el límite de 1000 bytes de custom claims: si un site_operator tiene muchos sitios, dejar sólo tenant_id+roles en el token y resolver site_ids en api.
- **§3.4 App móvil**: Perfil de pentest concreto para la app: MAS-L2 + MAS-R (maneja pagos), según los MAS Testing Profiles del MASTG/MASWE.
- **§6.2 Cloud SQL**: Detalle operativo del issue #2553 de cloud-sql-proxy (SQLSTATE 08P01 intermitente con MCP y --auto-iam-authn; mitigación: proxy ≥ v2.21 y reciclar conexiones del pool).
- **§4 Pagos**: Política de reintentos de Mercado Pago/Wompi/PayU marcada como pendiente de confirmar por pasarela (sólo Stripe verificada: 3 días, backoff exponencial, firma nueva en cada reintento).

### Afirmaciones marcadas "a confirmar"

- Cifra exacta de estaciones CCS sin TLS en el paper arXiv 2404.06635 (≈84 % según resúmenes; texto completo bloqueado).
- Que Cloud Run no termine mTLS en su URL run.app (el mTLS de frontend es función del ALB; no se encontró afirmación explícita en la documentación accesible).
- Lista exacta de suites TLS por perfil SSL del ALB (COMPATIBLE/MODERN/RESTRICTED) — sólo se confirmaron la existencia de los perfiles, que CUSTOM no afecta a TLS 1.3 y que la política por defecto es COMPATIBLE con TLS 1.0.
- Origen de la clave SupportedFileTransferProtocols (errata v4.0 de OCPP 1.6, no whitepaper) — confirmado sólo por fuente secundaria.
- Comportamiento de fallback del cargador al perfil anterior si no consigue conectar con el nuevo SecurityProfile (depende del fabricante).
- Existencia y semántica de la clave propietaria UseAuthorizationKeyWithoutDecoding por modelo de cargador.
- Plazo de notificación de brechas (72 h) en la Ley 21.719 de Chile.
- Políticas de reintento de webhooks de Mercado Pago, Wompi y PayU.
- Nombres exactos de las variables de cabecera mTLS adicionales (client_cert_dnsname_sans, client_cert_uri_sans, client_cert_leaf, client_cert_chain, subject_dn, valid_not_before/after); confirmadas sólo client_cert_present, client_cert_chain_verified, client_cert_error, client_cert_sha256_fingerprint y client_cert_serial_number.

## A.6 Capítulo 6 (DAT). Modelo de dominio, datos y eventos

Calificación inicial: 7.5 / 10. Errores corregidos: 11. Puntos añadidos: 6. Afirmaciones marcadas a confirmar: 4.


### Errores corregidos

| Sección | Error detectado | Corrección aplicada |
|---|---|---|
| §0 D5, §5.4, §4.2 charger.booted, §5.1 diagrama de secuencia, DDL charge_point.clock_offset_s, §9 checklist | El capítulo calculaba clock_offset_s a partir de BootNotification.req y Heartbeat.req; ninguno de los dos lleva timestamp (verificado en los esquemas JSON 1.6: BootNotification solo tiene vendor/model/seriales/firmware/iccid/imsi/meter; Heartbeat.req es {}), así que el offset era imposible de medir donde se decía. | El offset se mide con los mensajes que sí llevan timestamp recibidos en línea (StatusNotification, MeterValues, Start/StopTransaction), con mediana de los últimos N; BootNotification.conf/Heartbeat.conf solo resincronizan al cargador con currentTime. Se quitó clockOffsetS del payload de charger.booted y se añadió al diagrama de §5.1 el StatusNotification que fija el offset. |
| §3.1 máquina de estados del conector (párrafo y diagrama Mermaid) | Letras D/E asignadas al revés respecto a la tabla de la especificación (libocpp numera I4_ReturnToSuspendedEV e I5_ReturnToSuspendedEVSE, es decir, columna 4 = SuspendedEV y 5 = SuspendedEVSE) y faltaban transiciones que libocpp admite: A3/A4/A5 (Available → Charging/SuspendedEV/SuspendedEVSE, carga sin autorización previa), D8/E8 (Suspended* → Unavailable), H4/H5 (Unavailable → Suspended*), I4/I5/I7 (Faulted → Suspended*/Reserved). Además C8 se etiquetaba como 'ChangeAvailability Scheduled', pero con Scheduled el paso a Unavailable ocurre al terminar la transacción. | Se reordenaron las letras (D = SuspendedEV, E = SuspendedEVSE), se añadieron las 10 transiciones faltantes al diagrama, se reetiquetó C8 y se añadió nota sobre Scheduled; las celdas exactas de la tabla quedan marcadas 'a confirmar'. |
| §2.4, DDL sessions.unit, §9 checklist, §11 fuentes | El ENUM sessions.unit no admitía 'Celcius'; el esquema JSON oficial de OCPP 1.6 (MeterValues.json) usa esa grafía y la errata v4 obliga al Central System a aceptar ambas. Un cargador que reporte temperatura habría hecho fallar el INSERT. | Se añadió 'Celcius' al ENUM (validado en PostgreSQL 16.13), se documentó en §2.4 y en el checklist. |
| DDL §7 bloque 0 (extensiones) | CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman falla si el esquema partman no existe. | Se añadió CREATE SCHEMA IF NOT EXISTS partman antes de la extensión; se añadió el cron.schedule de partman.run_maintenance_proc() porque Cloud SQL no incluye el background worker de pg_partman. |
| §0 D6, §6.3 fila BigQuery, §11 fuentes | Precios de BigQuery 0,023/0,016 USD/GiB-mes presentados como verificados 'región EE. UU.'; las fuentes indican 0,02/0,01 en multirregión EE. UU. y 0,023/0,016 solo en algunas regiones (p. ej. asia-south1). | Se reescribió como orden de magnitud (≈ 0,02/0,01 en EE. UU.; 0,023/0,016 en otras regiones) marcado 'a confirmar' en la calculadora; se mantuvo USD 50/TiB de la suscripción BigQuery, que sí se confirmó. |
| §3.1 reglas de consistencia, §3.2 tabla de transiciones, §5.2, DDL ocpp_transaction | Se trataban como obligatorios campos opcionales: timestamp en StatusNotification.req (solo connectorId, errorCode y status son obligatorios), transactionId en MeterValues.req, y reason/idTag/transactionData en StopTransaction.req. | Regla (0) nueva: sin timestamp, status_at_cp = received_at; §5.2 renombrado a 'transactionId ausente o inválido'; en StopTransaction sin reason se guarda 'Local'; comentarios en el DDL. |
| §6.1 tamaño de fila | La estimación de 110 B en heap omitía charge_point_id/transaction_id (uuid) y source (text); el tamaño real ronda 150 B heap + 90 B índices ≈ 240 B. | Se corrigió el desglose y se aclaró que la tabla usa 200 B/fila como orden de magnitud que puede quedarse corta un 20 %. |
| §0 D6 y §6.1 tabla de flotas | La cifra '500 conectores a 30 s con 8 valores ≈ 86 M filas/mes' no explicitaba la hipótesis de 6 h de carga al día; el peor caso 24 h es 345,6 M filas. | Se explicitó la hipótesis (recalculado: 500 × 8 × 720 × 30 = 86,4 M) y se añadió la fila de 24 h (345,6 M filas, 69 GB/mes, 899 GB a 13 meses, 207 GB a 90 días). |
| §6.4 anonimización | 'expiran por la retención del topic (≤ 7 días por defecto)': los 7 días son la retención por defecto de la suscripción (máx. 31); la retención en el topic es opcional y está desactivada por defecto. | Reescrito con la semántica correcta. |
| §11 fuentes | La cita 'Central System SHALL always accept a start transaction request' se atribuía a reinierl/ocpp-rest/ocpp-1.6.rst, cuyo contenido es la especificación 1.5 (cabecera 'Document Version 1.5'). | Se aclaró la procedencia; la frase existe también en 1.6 edición 2 (extracto de regulations.gov), por lo que se mantiene el requisito marcado [V]. |
| §0 D3 y §11 fuentes | CVE-2026-28230 se citaba solo 'según OSV' y sin versiones afectadas; el issue #1296 (2023) no menciona el CVE. | Se añadió GHSA-6x38-4w7h-cwr8, SteVe ≤ 3.11.0, fechas de los issues #1293/#1296 y la aclaración de que el aviso es posterior al issue. |

### Puntos añadidos

- **§6.3 política de retención (fila nueva 'Cloud SQL') y §9 checklist**: Backups automáticos + PITR de Cloud SQL activados antes del primer cargador en producción y restauración de prueba mensual; sin PITR un UPDATE erróneo en tarifas o sesiones no se puede deshacer.
- **§9 checklist**: Alerta operativa si la fila más antigua de ops.event_outbox sin published_at supera 60 s: un relay caído congela la app y el back-office sin que falle ningún mensaje OCPP.
- **§9 checklist y §3.1**: Reglas para campos opcionales del protocolo que aparecen el primer día: StatusNotification sin timestamp, MeterValues sin transactionId, StopTransaction sin reason (= Local), unidad 'Celcius'.
- **§3.1 párrafo introductorio y diagrama**: Lista explícita de transiciones de conector que suelen olvidarse y que el CSMS debe aceptar sin marcar error (A3/A4/A5, D8/E8, H4/H5, I4/I5/I7).
- **§5.4**: Detección de reloj 'en 1970' tras un corte de energía mediante clock.skew_clamp_s.
- **§6.5 y DDL**: Cloud SQL no trae el background worker de pg_partman: el mantenimiento debe programarse con pg_cron o Cloud Scheduler (línea cron.schedule añadida).

### Afirmaciones marcadas "a confirmar"

- Celdas exactas (letra+número) de la tabla 'Status transitions' de la especificación OCPP 1.6: la copia oficial (regulations.gov / openchargealliance.org) está bloqueada; se adoptó la numeración de libocpp (4 = SuspendedEV, 5 = SuspendedEVSE) y se marcó 'a confirmar'.
- Precios de lista de BigQuery (0,02/0,01 vs 0,023/0,016 USD/GiB-mes según región) y de Cloud Storage Coldline/Archive (0,004 / 0,0012 USD/GB-mes): fuentes secundarias discrepan; marcados como orden de magnitud 'a confirmar' en la calculadora.
- Versiones exactas de pg_partman/pg_cron/PostGIS en Cloud SQL para la versión mayor de PostgreSQL elegida (docs.cloud.google.com bloqueado; disponibilidad confirmada por varias fuentes secundarias concordantes).
- Comportamiento de firmwares que envían transactionId = -1/0 en MeterValues encolados antes del StartTransaction.conf: observación de campo, ahora marcada 'a confirmar con el proveedor'.

## A.7 Capítulo 7 (OPS). Operación diaria, monitoreo, calidad, roadmap y decisiones

Calificación inicial: 8 / 10. Errores corregidos: 18. Puntos añadidos: 7. Afirmaciones marcadas a confirmar: 10.


### Errores corregidos

| Sección | Error detectado | Corrección aplicada |
|---|---|---|
| Cabecera (nota de verificación) y §10 | La nota describía el proceso de revisión (proxy de la sesión, dominios bloqueados, 'vía búsqueda') y §10 repetía 'sitio bloqueado para lectura directa'. | Reescrita como 'Nota de verificación' neutra que sólo indica qué se contrastó, con qué fuentes y el nivel de confianza; §10 actualizado con las fuentes leídas y sin referencias al proceso. |
| §0 O4, §2.2, §2.4, §8.2 | La métrica `remote_start_e2e_seconds` se definía de tres formas incompatibles (hasta `StartTransaction.req`, hasta `RemoteStartTransaction.conf`, 'desde Preparing'), y O4 decía 'app → StartTransaction' para un SLO que depende de cuándo enchufa el conductor. | Se separan dos métricas: `remote_start_ack_seconds` (POST → `RemoteStartTransaction.conf`, es el SLO p95 < 5 s) y `remote_start_e2e_seconds` (conf → `StartTransaction.req`, informativa para el SLI 'arranque efectivo'); O4, §2.4 y §8.2 actualizados coherentemente. |
| §0 O9 y §6.1 | Total del roadmap inconsistente: O9 decía 12-16 meses y §6.1 13-18 meses; la suma de fases es 54-72 semanas. | Ambos fijados en 54-72 semanas (≈ 12-17 meses), con MVP entre la semana 18 y 24; se añade que el gantt suma ≈ 17/18/24 semanas por fase, dentro de los rangos. |
| §1.4 notas (WebSocketPingInterval) | Afirmaba que un ping de 60 s 'queda por debajo del timeout de backend del ALB'; el backend service timeout por defecto es 30 s y cierra los WebSockets inactivos, por lo que sin subir `timeoutSec` la afirmación es falsa. No se mencionaba el cierre de WebSockets activos a las 24 h. | Se explica que el ping de 60 s sólo sirve si `timeoutSec` se subió (ARQ §3.1, verificar en Terraform), que el gateway hace ping propio a 30 s, y que el ALB cierra los sockets activos a las 24 h (reconexión diaria esperada). |
| §3.1 y §3.2 (Reset) | Semántica imprecisa: 'Hard: reinicio completo, puede perder cola offline' y 'el cargador enviará StopTransaction reason=SoftReset/HardReset' como si fuera igual en ambos casos. | Redactado según la spec 1.6 / errata v4.0: Soft = parar transacciones ordenadamente y enviar `StopTransaction.req` por cada una; Hard = reiniciar hardware sin obligación de parar ordenadamente, `StopTransaction` 'si es posible' tras el nuevo `BootNotification.conf`; por eso Hard puede dejar la sesión huérfana. |
| §3.2 y §3.4 (UnlockConnector) | 'Si hay transacción activa, muchos firmwares la terminan': la spec 1.6 exige que el cargador termine la transacción primero (`reason=UnlockCommand`) e indica no usarlo como parada remota. | Corregido como requisito de la spec [V]; RB-02 aclara que se desbloquea sólo cuando ya no hay transacción, tras `RemoteStopTransaction`. |
| §3.2 (ChangeAvailability) | 'persiste tras reinicio en la mayoría de firmwares' presentado como hecho sin fuente. | Reformulado: atributo persistente del conector que debería conservarse; comportamiento a confirmar por modelo (pregunta 5 de §9.2 ampliada). |
| §3.2 (GetDiagnostics) | 'El cargador suele necesitar FTP/FTPS o HTTP PUT' como si la spec lo fijara. | Se aclara que la spec sólo define `location` como URI y que el protocolo de subida depende del firmware (a confirmar por modelo). |
| §1.4 plantilla JSON y §1.5 DDL | `optional_keys` mezclaba un measurand (`SoC`) con configuration keys. | Se separa `optional_measurands` (SoC, Power.Offered) de `optional_keys`; columna añadida en `assets.config_template`; nota explica qué keys son opcionales en la spec 1.6. |
| §2.4 SLO de disponibilidad del gateway | El SLI mezclaba la salud de la plataforma con '≥ 99 % de los cargadores esperados conectados', de modo que un corte de la red móvil consumiría el error budget del gateway. | SLI basado sólo en el cargador sintético vía ALB; la conectividad del parque se sigue como KPI aparte (§8.2). |
| §4.3 contract tests | 'JSON Schemas oficiales de OCA (edición 2020:3…)' — designación de edición inexistente. | Reformulado: esquemas oficiales 1.6 más los de los mensajes del Security Whitepaper (3.ª ed.), distribuidos en `mobilityhouse/ocpp` [V]. |
| §4.4 simuladores | MicroOcpp presentado como cliente '1.6 / 2.0.1' con 'UCs básicos de 2.0.1' cuando su README indica que 2.0.1 está en alfa y desactivado por defecto; EVerest: se afirmaba que `everest-demo` se apunta a otro CSMS con `CentralSystemURI` etc. (las demos publicadas son 2.0.1 con MaEVe/CitrineOS) y se omitía que libocpp 2.0.1 está certificado por OCA y 2.1 en desarrollo. | Filas reescritas con lo verificado en los READMEs [V]; los nombres de config de libocpp 1.6 quedan 'a confirmar'. |
| §4.5 k6 | No se indicaba desde qué versión `k6/websockets` es estable ni la relación con `k6/experimental/websockets` y `k6/ws`. | Estable desde k6 v1.6.0 (feb 2026) [V]; experimental obsoleto con la misma API; `k6/ws` es el módulo antiguo; se añade `ws_ping` y una variante de prueba de 25 h para observar el cierre del ALB a las 24 h. |
| §4.6 caos | Presentaba Litmus (incluidas fallas de red y CPU/memoria) como directamente utilizable en Autopilot y sólo Chaos Mesh como necesitado de allowlist. | Se precisa que en Autopilot sólo `pod-delete` funciona sin allowlist; fallas de red/recursos y el daemon de Chaos Mesh requieren allowlist de cargas privilegiadas; sin fallas a nivel de nodo. |
| §4.7 OCTT y certificación | Número de certificado con formato inventado (`OCA.0016.xxxx.CS`); modelo de licencia descrito de forma imprecisa ('suscripción anual + licencia'); las suites abiertas citadas sin describir su alcance real. | Formato sustituido por la comprobación en la lista pública 'Certified products' de OCA [V]; licencia = compra única por juego de casos + suscripción anual, no miembros admitidos con descuento a miembros, prueba en laboratorio neutral y certificado emitido por OCA [V]; precios 'a confirmar'; tzi-OCTT (75 escenarios 1.6J + 252 de 2.0.1, MIT) y open-ocpp-tck (47 escenarios 1.6, drivers SteVe/CitrineOS, Apache-2.0) descritos [V] y señalados como no oficiales. |
| §4.8 despliegue (extended duration pods y código 1012) | Extended duration pods marcados 'confianza baja/no leído'; 1012 sin fuente; 'WebSocket necesita 90-120 s' como si fuera una regla de GKE. | Verificado: anotación `safe-to-evict: false` protege hasta 7 días frente a actualizaciones automáticas de nodo y scale-down en Autopilot 1.27+ [V], con la consecuencia operativa de un rolling restart controlado cada ≤ 6 días; 1012 = 'Service Restart' del registro IANA con reconexión aleatoria 5-30 s [V] y nota de que no todos los firmwares lo interpretan; la cifra de 90-120 s se sustituye por el cálculo propio (30 s de drenado + margen) y la propagación de endpoints queda orientativa. |
| §5 D6 | Presupuesto USD 400-650/mes y '+40 % con 3 personas' presentados como cifras firmes. | Marcados como orden de magnitud / estimación de planificación, a confirmar con la calculadora de precios de Google Cloud. |
| §2.3 alarmas y §2.2 métricas | La alarma 'Gateway saturado' y `ocpp_reconnects_total` contaban como tormenta la reconexión diaria por el cierre del ALB a las 24 h. | Nuevo `reason=lb_24h` excluido de la alarma; RB-01 y RB-09 explican la 'falsa tormenta' diaria tras un go-live. |

### Puntos añadidos

- **§3.11 Mantenimiento preventivo**: Párrafo 'Primer mes en producción (hypercare)': revisión diaria de alarmas, auto-remediación desactivada hasta tener la matriz de conformidad, umbral OFFLINE provisional a 5×HeartbeatInterval, despliegues sólo vigilados, exportación diaria de tramas para el proveedor y conciliación PSP/energía en 0 antes de capturar en lote.
- **§1.3 paso 2 (credenciales)**: Qué hacer cuando la clave de bootstrap caduca (24 h) antes de la instalación: reemisión auditada desde backoffice, sin prórroga.
- **§1.3 paso 5 (Pending)**: Reglas del estado Pending según la spec 1.6: canal abierto, el CSMS puede leer/cambiar configuración, el cargador no inicia peticiones salvo BootNotification/TriggerMessage, RemoteStart/Stop no permitidos.
- **§1.4, §2.2, §3.3, §3.9, §4.5**: Reconexión diaria esperada por el cierre del ALB a las 24 h de socket activo: etiqueta `lb_24h`, exclusión de alarmas, explicación de la 'falsa tormenta' y prueba de carga de 25 h.
- **§3.2 UpdateFirmware**: Tras `Installed` se espera un BootNotification con el nuevo `firmwareVersion` que debe compararse con el esperado y registrarse como `FirmwareUpdated`.
- **§4.8 punto 4**: Consecuencia operativa de los extended duration pods: rolling restart controlado cada ≤ 6 días porque la protección expira a los 7.
- **§9.2 pregunta 5**: Preguntar al proveedor si `Inoperative` se conserva tras reinicio/corte eléctrico y si el StopTransaction se envía antes o después del reinicio.

### Afirmaciones marcadas "a confirmar"

- Persistencia del estado Inoperative de ChangeAvailability tras reinicio (texto exacto de la spec 1.6 §5.2 no localizado; marcado 'a confirmar por modelo').
- Protocolo de subida de GetDiagnostics (FTP/FTPS/HTTP) por modelo de cargador.
- Comportamiento del firmware al recibir una CSL de MeterValuesSampledData con un measurand no soportado (Rejected a toda la key).
- Tiempo de reconexión tras Reset(Soft) (< 3 min es umbral propio).
- Precios concretos de OCTT (licencia por juego de casos y suscripción anual).
- Nombres exactos de configuración de libocpp 1.6 (`CentralSystemURI`, `SecurityProfile`, `AuthorizationKey`) para apuntar EVerest a otro CSMS.
- Restricciones completas de los extended duration pods de Autopilot (Spot, DaemonSets, fallos de nodo).
- Tiempo de propagación de endpoints/NEG (5-15 s, orientativo).
- Presupuesto de infraestructura USD 400-650/mes y el '+40 % con 3 personas' (estimaciones de ARQ/planificación).
- Interpretación del código de cierre 1012 por cada firmware de cargador (pregunta al proveedor).


Totales: 99 errores corregidos, 50 puntos añadidos, 57 afirmaciones a confirmar.
