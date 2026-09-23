# 0019. Dominio `supercargadores.co` y nombres de host de la plataforma

Fecha: 2026-09-22. Estado: aceptada.

## Contexto

La plataforma necesita nombres públicos con certificado TLS para tres entradas: los cargadores (WebSocket OCPP), la API (app Volt y back-office) y el back-office web. El dueño ya posee `supercargadores.co`, con la zona DNS administrada en Netlify DNS y un sitio en la raíz del dominio. Comprar otro dominio no aporta nada: los cargadores y la app no muestran el nombre, y la marca de la app sigue siendo Volt.

## Decisión

1. **Se usa `supercargadores.co`.** La raíz del dominio y el sitio actual no se tocan; la plataforma vive en subdominios.
2. **Nombres de host** (producción):
   - `ocpp.supercargadores.co`: gateway OCPP. URL que se configura en cada cargador: `wss://ocpp.supercargadores.co/ocpp/{chargeBoxId}`.
   - `api.supercargadores.co`: API pública `/v1` (app Volt) y de administración `/admin/v1`.
   - `admin.supercargadores.co`: back-office web (iteración 6).
   - `app.supercargadores.co`: versión web de la app y enlaces de pago de deuda (iteración 7).
   Staging usa el sufijo `-staging` (`ocpp-staging.`, `api-staging.`, `admin-staging.`, `app-staging.`); desarrollo no tiene nombres públicos.
3. **La zona sigue en Netlify DNS.** No se migra a Cloud DNS: la iteración 8 crea en Google Cloud una IP estática por entorno para el balanceador y el dueño añade en Netlify DNS un registro `A` por host apuntando a esa IP (TTL 300 segundos). Los certificados los emite Google (Certificate Manager, gestionados) una vez los registros resuelven; no hay que comprar ni renovar certificados.
4. **Mensajería y correo** no forman parte de esta decisión; el dominio de correo de los conductores (recibos) se decide con la iteración 5.

   *Adición del 23 de septiembre de 2026:* el remitente de recibos y avisos a conductores es `notificaciones@supercargadores.co` (buzón creado por el dueño). El servicio de envío (SMTP de Google Workspace o un proveedor transaccional) se decide en la iteración 7 junto con las plantillas de correo.

## Alternativas consideradas

- **Delegar la zona a Cloud DNS**: permitiría que Terraform cree los registros solo; a cambio obliga a mover el sitio actual y los registros existentes. Se puede hacer más adelante sin cambiar los nombres.
- **Dominio nuevo con la marca Volt**: coste y trámite sin beneficio funcional; los nombres de host no son visibles para el conductor.

## Consecuencias

- La iteración 8 entrega al dueño la lista exacta de registros (host, tipo, valor) por entorno; hasta entonces no hay nada que crear.
- Los cargadores se comisionan con la URL `wss://ocpp.supercargadores.co/ocpp/{chargeBoxId}` (y `ocpp-staging` para el laboratorio); las plantillas de configuración de `config.ocpp_config_template` deben usar esos nombres.
