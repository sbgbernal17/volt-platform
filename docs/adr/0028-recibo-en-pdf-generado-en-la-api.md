# 0028. Recibo de carga en PDF generado en la API

Fecha: 2026-09-30. Estado: aceptada.

## Contexto

El dueño pidió que en Actividad quede el PDF "de lo que sería la factura". Hasta ahora el recibo existía como JSON y como HTML sin marca (solo abría en un WebView nativo); en la web no había forma de guardarlo. La factura electrónica ante la DIAN llega en la iteración 10 con el proveedor tecnológico; mientras tanto el documento es un recibo de carga, y así se llama.

## Decisión

1. La API genera el PDF (`GET /v1/sessions/:id/receipt?format=pdf`, y la misma opción en `/admin/v1`) con **pdf-lib**, biblioteca de JavaScript puro con licencia MIT, que se empaqueta en el único archivo de la API sin leer nada del disco en tiempo de ejecución (la imagen de Cloud Run no lleva `node_modules`). Chromium o Puppeteer quedan descartados por tamaño y por Alpine.
2. Contenido: logotipo rojo (trazado del manual de marca), razón social, número y fecha, adquiriente (nombre, documento si lo hay y correo), sede y cargador, inicio y fin en hora de Colombia, energía, líneas de costo, total, pago (proveedor, referencia y fecha), tarifa y la nota "Este recibo no es una factura electrónica". Tipografías estándar Helvetica por ahora; las de marca (Barlow, Roboto) se incorporarán cuando se decida sumar sus archivos al paquete.
3. Entrega: cabeceras `content-disposition` con el nombre `recibo-<número>.pdf` y `cache-control: private, no-store`; la API expone `content-disposition` en CORS. La app web lo descarga con el token en la cabecera y lo entrega como archivo; iOS y Android lo bajan a la caché con `expo-file-system` y abren la hoja de compartir con `expo-sharing` (guardar en Archivos, correo, WhatsApp). El back-office abre el PDF en otra pestaña desde el detalle de la sesión.
4. Se descarga desde la pantalla del recibo (botón "Descargar PDF" en todas las plataformas, que sustituye a la versión imprimible) y desde la lista de Actividad en cada sesión con recibo.

## Alternativas consideradas

- Generar el PDF en la app (expo-print): distinto por plataforma y sin la marca controlada por el servidor; en la web solo imprime.
- Enlace firmado sin token para abrirlo en el navegador del sistema: exige un secreto y un endpoint nuevos; se puede añadir después para los correos.
- Adjuntar el HTML actual: no es lo que el conductor espera guardar ni enviar.

## Consecuencias

- Dependencias nuevas: `pdf-lib` en `@volt/csms`; `expo-file-system` (ya venía dentro de Expo) y `expo-sharing` (módulo nativo nuevo) en la app. **Hace falta una compilación de EAS nueva** para que la descarga funcione en las apps de las tiendas; en Expo Go y en la web funciona ya.
- La iteración 10 reemplazará este PDF por la representación gráfica de la factura electrónica que entregue el proveedor, o la pondrá al lado, según lo que defina el contador.
- El recibo por correo (iteración 10) reutiliza `renderReceiptPdf` como adjunto.
