# 0021. Identidad del personal con Identity Platform, RBAC, auditoría inmutable y back-office

Fecha: 2026-09-23. Estado: aceptada.

## Contexto

La iteración 6 entrega el back-office del operador (FUN M13, M19 y M20; OPS §3 y §4; SEG §3.1 y §3.2). Hacía falta decidir cómo se identifica el personal, dónde viven los roles, cómo se autoriza cada ruta de `/admin/v1`, cómo queda la auditoría "quién cambió qué y cuándo" y cómo se sirve la aplicación web. La verificación de Google Cloud del 22 de septiembre mostró que Identity Platform tiene la API habilitada en los tres proyectos pero no está inicializado (`CONFIGURATION_NOT_FOUND`), así que el diseño tenía que funcionar en laboratorio sin Google y en producción solo con Google.

## Decisión

1. **Identity Platform emite la identidad; la plataforma decide el rol.** El back-office inicia sesión con correo y contraseña en Identity Platform (SDK de Firebase) y envía el ID token en `Authorization: Bearer`. La API verifica la firma RS256 con las claves públicas de Google (`securetoken@system.gserviceaccount.com`), el emisor `https://securetoken.google.com/<proyecto>` y la audiencia, sin dependencias externas. La cuenta de personal (`auth.staff_user`) guarda correo, rol, alcance y estado; el `sub` del token se vincula en el primer inicio de sesión solo si el correo está verificado (así nadie se apropia de una invitación registrando ese correo). No se usan *custom claims*: el rol se resuelve en la base de datos en cada petición.
2. **Roles fijos del MVP** (ADR 0004): `ADMIN`, `OPERATIONS`, `SUPPORT`, `READ_ONLY` y `SITE_OWNER` (alcance por `site_ids`, solo lectura de sus sedes). Los permisos son constantes de área y verbo (`commands:execute`, `pricing:publish`, `billing:refund`, …) en `@volt/csms` (`staff/rbac.ts`). `SUPPORT` solo envía `RemoteStopTransaction`, `UnlockConnector` y `TriggerMessage` y devuelve o condona hasta `billing.support_refund_limit_minor`.
3. **Política central por ruta.** Cada ruta de `/admin/v1` declara su permiso y, si cambia estado o accede a datos personales, su acción de auditoría (`apps/api/src/admin/policy.ts`). Una ruta sin entrada se rechaza (`NO_POLICY`); una prueba recorre todas las rutas registradas y falla si falta alguna.
4. **MFA y sesión.** Los roles de `auth.staff_mfa_roles` (por defecto `ADMIN` y `OPERATIONS`) solo pueden operar con segundo factor: la API exige `firebase.sign_in_second_factor` en el token y el back-office guía la inscripción TOTP. La antigüedad máxima del inicio de sesión es `auth.staff_session_max_h` (12 h); pasada, la API responde `REAUTH_REQUIRED`. Las *blocking functions* e Identity-Aware Proxy del diseño quedan para la iteración 8 (infraestructura).
5. **Token estático solo en laboratorio.** `API_ADMIN_TOKEN` sigue existiendo para pruebas y automatización (administrador con actor `staff:admin-token` o el `X-Actor` declarado), pero la configuración lo prohíbe en producción, donde es obligatorio `IDENTITY_PLATFORM_PROJECT_ID`.
6. **Auditoría inmutable con cadena de hashes** (SEG §2.8) en `audit.audit_log`: cada mutación de `/admin/v1` (y las lecturas de datos personales) escribe actor, acción, entidad, petición y resultado con secretos redactados, antes de que el cliente reciba la respuesta; `hash = sha256(prev_hash || json canónico)`, escrituras serializadas con un bloqueo consultivo, `UPDATE`/`DELETE`/`TRUNCATE` rechazados por trigger y verificación diaria en el worker con alarma `AUDIT_CHAIN_BROKEN`.
7. **Back-office como SPA React (Vite)** en `apps/backoffice`, sin enrutador ni gestor de estado de terceros; internacionalización propia (español e inglés, ADR 0005); mapa con Leaflet y OpenStreetMap; se sirve desde su propio contenedor nginx con la URL de la API inyectada al arrancar (`config.js`) y la API admite CORS solo para los orígenes de `API_CORS_ORIGINS`. La configuración pública del proveedor de identidad la entrega la API (`GET /admin/v1/auth/config`), de modo que la misma imagen sirve para todos los ambientes.

## Alternativas consideradas

- **Roles en *custom claims* del token**: evita una consulta por petición, pero obliga a un backend con Admin SDK para cambiarlos y retrasa los cambios hasta que el token se renueva (1 h). Con la base de datos, deshabilitar a alguien es inmediato.
- **Cookies de sesión propias**: más trabajo y otra superficie de ataque; el ID token de Identity Platform ya rota cada hora.
- **Servir la SPA desde la API**: simplifica CORS, pero mezcla ciclos de release y obliga a la API a servir estáticos en Cloud Run; el diseño (ARQ §1.4) ya separaba el back-office.
- **Biblioteca de UI y enrutador de terceros**: descartados por la regla de mínimas dependencias; el enrutador propio tiene 80 líneas y pruebas.

## Consecuencias

- El primer administrador se invita con `API_STAFF_BOOTSTRAP_EMAIL` (arranque sin personal) o desde el back-office con el token de laboratorio; la persona debe existir en Identity Platform con el correo verificado.
- Identity Platform debe inicializarse en cada proyecto (consola → Identity Platform → Habilitar) con correo y contraseña y MFA TOTP; el flujo `Verificación de Google Cloud` lo comprueba.
- La iteración 8 añade Identity-Aware Proxy delante del back-office, las *blocking functions* y la exportación diaria de la auditoría a un bucket con retención bloqueada.
