# 0025. Sistema de diseño de la app Volt a partir del handoff de UI/UX

Fecha: 2026-09-30. Estado: aceptada.

## Contexto

El dueño entregó el handoff de UI/UX de la app (documento `VOLT App — Handoff de UI/UX` y 25 pantallas en HTML) y pidió tomar de él lo que aplique y ajustarlo a lo que el producto ya tiene. La app (ADR 0022 y 0024) ya cubría el flujo completo con el manual de marca (docs/marca), pero con una interfaz genérica: lista y mapa en tarjetas, pestañas nativas, detalle del conector en texto, carga en vivo en tarjetas de datos, historial en tarjetas. El handoff define un sistema visual completo (tokens, componentes, pantallas y estados) y una navegación con el botón central "Cargar".

## Decisión

1. **Se adopta el sistema visual del handoff como el sistema de diseño de la app**, encima de los tokens del manual: `apps/mobile/src/theme/tokens.ts` (colores, escala tipográfica, espaciado, radios, tamaños, movimiento), `src/theme/ui.tsx` (botones con ícono y estados, botón redondo, chips, campos de 52 px con prefijo y ojo, casilla, interruptor, insignias con ícono, avisos con ícono y acción, tiles de datos, filas de lista y de datos, estado vacío, fila superior) y los componentes de `src/components/` (anillo de carga, lista de pasos, diálogo inferior, hoja inferior, esqueletos, insignia de conector, marcador píldora y barra de pestañas). Los cuatro valores marcados como propuestos en el handoff (ámbar de ocupado, cifra XL de 72 px, radio de hoja de 20 px y tiempos de movimiento) quedan adoptados a la espera del visto bueno del dueño.
2. **Navegación:** Mapa · **Cargar** · Actividad · Cuenta con la barra propia de 84 px; el botón central abre el escáner a pantalla completa o, con una carga en curso, la carga en vivo con el rayo y el porcentaje. El escáner, el detalle de estación, la confirmación del cargador, la carga en vivo y el recibo no llevan barra nativa: traen su propia fila superior.
3. **Invitado:** el mapa, las estaciones y el precio se ven sin cuenta (`/v1/locations` y `/v1/evses/:id` ya eran públicos). El registro aparece al iniciar una carga y, al terminar, la app vuelve al cargador desde el que salió.
4. **Mapa:** pantalla completa, estilo oscuro del handoff (sin puntos de interés de otras marcas), marcadores píldora con libres/total y potencia al seleccionar, ubicación del conductor con `expo-location` (dependencia nueva: es el módulo oficial de Expo y no había otra forma de mostrar distancias y "en sitio"), búsqueda y filtros en el cliente, hoja inferior con las estaciones cercanas o la estación elegida (potencia, disponibles, tarifa, conectores, VER ESTACIÓN, CÓMO LLEGAR y, a menos de 150 m, INICIAR CARGA). La lista sigue siendo la alternativa accesible y la vista de la web sin clave de mapas.
5. **Flujo de carga:** estación con cargadores seleccionables (número, potencia, conector, estado, texto de apoyo) → confirmación (potencia, conector, tarifa desagregada, medio de pago) → "Conecte su vehículo" con pasos mientras el cargador espera el cable → carga en vivo (anillo con batería o kWh, En vivo, rejilla de energía, potencia, tiempo y costo, DETENER como botón secundario, diálogo de finalización) → carga completada (cifra de kWh, duración, total, estación, cargador, fecha, pago, aviso de desconectar, recibo). Estados excepcionales: sin datos en vivo (anillo gris, cifras apagadas, aviso ámbar y reintento), pago rechazado (lista de pasos con el fallo y USAR OTRA TARJETA), falla del cargador (parada anómala o cierre estimado, con código para soporte), sin ubicación, sin conexión (aviso con la antigüedad de los datos), historial vacío, QR inválido y cámara sin permiso.
6. **Textos:** trato de usted, verbo primero, sin exclamaciones, formatos colombianos; español e inglés con las mismas claves (prueba automática).

## Adaptado o aplazado (y por qué)

- **Vehículos, compatibilidad y tiempo estimado de carga:** el backend no modela vehículos del conductor. Se aplaza; el handoff lo deja como "Mis vehículos" y la línea "Compatible con su …".
- **Celular y código SMS en el registro:** la identidad usa correo y contraseña con verificación por correo (ADR 0022). El celular se captura en el perfil.
- **Aceptación de términos en el registro:** se mantiene la pantalla de consentimientos con registro de versión (Ley 1581, ADR 0022); el registro muestra la nota y los enlaces.
- **Fotos de estaciones, servicios cercanos, favoritos, calificación con estrellas, precio máximo en filtros, "Ver todo el historial" de pagos:** sin datos ni backend todavía; quedan como pendientes visuales del handoff.
- **Material Symbols Outlined:** se usa Material Icons de `@expo/vector-icons`, ya en el paquete, con los mismos nombres; incorporar la fuente Material Symbols (varios MB) es una decisión del dueño.
- **Arrastre de la hoja inferior, hápticos y agrupación de marcadores:** la hoja alterna dos alturas al tocar el asa; sin `@gorhom/bottom-sheet` ni `expo-haptics` (dependencias nuevas que no cambian el flujo). Con las tres estaciones actuales no hace falta agrupar marcadores.
- **Factura electrónica en el recibo:** el recibo dice que la factura llegará al correo cuando esté habilitada (iteración 10, DIAN), no "en proceso".
- **Numeración de cargadores:** el handoff numera 01, 02… por estación; la app numera por el orden de la lista y muestra siempre el identificador del conector (el que va impreso en el QR).

## Consecuencias

- Toda pantalla nueva usa `src/theme/ui.tsx` y `src/components/`; no se añaden bibliotecas de UI.
- `expo-location` entra en `app.json` con el texto de permiso "mientras usa la app" (iOS y Android); no hay ubicación en segundo plano.
- Las capturas de referencia se generan con la versión web contra una API simulada (`lab/` no; script local del laboratorio de la sesión) y el dueño las revisa en `app-dev`.
- Pendientes del dueño en `docs/tareas-del-dueno.md`: aprobar los tokens propuestos, decidir Material Symbols y la fuente del ícono de la app, fotos de las estaciones y si se modelan vehículos.

## Adición 2026-09-30: tres pestañas

A pedido del dueño, la barra pasa de cuatro destinos a tres (Mapa · Cargar · Cuenta) para que el botón Cargar quede centrado. La actividad (sesiones por mes y recibos) se abre desde Cuenta, como primer acceso rápido y como fila para el invitado; la ruta `history` sigue existiendo fuera de las pestañas con barra superior y botón de volver. Las capturas 14 y 24 del handoff se leen ahora como pantallas hijas de Cuenta.
