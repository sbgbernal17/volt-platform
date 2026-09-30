# 0030. El back-office adopta el sistema de diseño de la app

Fecha: 2026-09-30. Estado: aceptada.

## Contexto

El dueño pidió usar en el back-office los conceptos de diseño de la app (ADR 0025): estados por palabra, ícono y color; botones en mayúsculas; insignias, avisos y mosaicos con la misma forma; tema oscuro con la misma paleta. El back-office ya compartía casi todos los valores de color con la app, pero no tenía íconos, sus insignias y avisos eran más pequeños y sin ícono, varias pantallas elegían colores por su cuenta y algunos estados salían en inglés crudo. El manual de marca dice que la web es de tema claro por defecto y oscuro cuando el sistema lo pide.

## Decisión

1. **Tokens compartidos** en `styles.css`: se añaden los que faltaban (texto deshabilitado, borde suave, barra, fondo del diálogo, radios, tamaños de botón, insignia e ícono, tiempos de animación) y el ámbar de ocupado del handoff (#33260F en oscuro). La paleta oscura es la de la app.
2. **Tema**: sistema por defecto, como pide el manual, y un selector en la barra lateral (Sistema, Claro, Oscuro) guardado en `volt.theme` y aplicado antes del primer pintado por `public/theme.js` (la CSP solo admite scripts propios). El oscuro forzado replica exactamente la preferencia del sistema.
3. **Íconos**: Material Icons por ligadura, con los mismos nombres que la app (`components/icon.tsx`). La fuente se sirve desde el propio back-office (`public/fonts`, el mismo archivo Apache 2.0 que distribuye la app) para que los íconos no dependan de Google Fonts ni se vean como texto si la red falla. Cuando el dueño decida Material Symbols (tarea 9f), cambian las dos interfaces a la vez.
4. **Estados en un solo módulo** (`lib/status.ts`): conectores, ciclo de vida, sesiones, pagos, severidad y cobro del conductor devuelven palabra traducida, ícono y color; las insignias miden 28 px con ícono de 18 px y tienen variantes con borde y punteada como en la app. Las sesiones y los pagos dejan de mostrar el enum en inglés.
5. **Componentes**: botones de 44 px en mayúsculas (52 px el primario de formularios y diálogos; en la app son 52 px; en la web se adapta la densidad), secundario transparente, destructivo con borde, deshabilitado sin opacidad; avisos con fondo suave, radio de tarjeta e ícono; mosaicos KPI como los de la app; estado vacío con círculo e ícono; cabecera de página con flecha de volver y subtítulo; selector segmentado para Mapa · Lista; barra lateral con íconos y el activo en rojo Volt sobre negro (#0B0B0B) en oscuro.
6. Lo que no cambia: el degradado del encabezado es exclusivo de la app (marca plana en la web), el mapa sigue con su estilo claro, y la tipografía se mantiene (Barlow para títulos, Roboto para interfaz, con el peso 500 añadido).

## Alternativas consideradas

- Un paquete compartido de tokens para las dos interfaces: deseable, pero la app importa tipos de React Native y el back-office es CSS; se difiere hasta que el sistema se estabilice (el ADR 0025 sigue siendo la fuente).
- Tema oscuro por defecto en el back-office: contradice el manual; queda como elección del usuario.
- Íconos como SVG incrustados: 25 archivos que mantener; la fuente por ligadura coincide con la app y pesa 350 KB una sola vez.

## Consecuencias

- Todas las pantallas cambian de aspecto sin tocar su lógica: los componentes compartidos concentran el cambio.
- Pendiente: estilo oscuro del mapa cuando el tema es oscuro; revisión del dueño sobre el tamaño de los botones en la web.
