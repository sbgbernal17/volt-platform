# Marca VOLT en la plataforma

El manual de marca vive en el sistema de diseño del dueño (artefacto "VOLT", <https://claude.ai/artifact/CBnyNf6S9QeKRDd7pMy6RJ>). Esta carpeta guarda la copia que usa el código: `tokens.json` (colores, tipografía, espaciado, radios, logotipo y sombras, tal cual el manual) y las reglas que aplican al back-office y a la app. Si el manual cambia, se vuelve a copiar `tokens.json` y se ajustan los tokens CSS.

## Resumen del manual (23 de septiembre de 2026)

- **VOLT** es la marca de Supercargadores Vehiculares S.A.S. (Itagüí y Medellín). "VOLT" en mayúsculas en texto corrido; la razón social completa en contratos, facturas y documentos legales.
- **Un solo rojo protagonista** (`rojo-volt` #EF4136, el del logotipo). Negro (#0B0B0B) y blanco son el escenario. Proporción por pieza: 60 % neutro, 30 % texto e imagen, 10 % rojo. Plana: sin sombras ni degradados, salvo el degradado del encabezado de la app y la sombra de menús flotantes en tema claro.
- **Rojo acción** (#DC2626) es el relleno del botón primario y de la pestaña activa, con texto blanco (4,8:1). Un solo botón primario por pantalla, texto en mayúsculas (`boton`). Rojo presionado #B91C1C; rojo profundo #991B1B para bandas y tramo medio del degradado.
- **Estados**: `verde-disponible` y `azul-info` (con `verde-suave` y `azul-suave`) solo para estados e íconos funcionales; siempre con palabra e ícono, el color solo refuerza. Nunca `rojo-volt` para estados.
- **Tipografía**: Barlow Semi Condensed para titulares (ExtraBold cursiva solo en `titular-xl` y `titular-l`; títulos internos rectos 700/600) y Roboto para texto e interfaz. Nunca una tercera familia. Alineación a la izquierda.
- **Espaciado** en múltiplos de 4 px; márgenes laterales de la app 30 px. **Esquinas**: 6 px en controles, 12 px en tarjetas, rectas en impresos.
- **Logotipo**: solo desde `volt-logo-rojo|blanco|negro.svg`; proporción 2124 × 905; zona de protección 17 % de la altura; ancho mínimo 120 px en pantalla y 30 mm impreso. Rojo sobre blanco (y válido sobre negro), blanco sobre rojo/negro/foto oscura, negro a una tinta.
- **Voz**: técnico de confianza; trato de usted; frases cortas con el verbo al inicio; sin exclamaciones, superlativos ni emojis; tildes y signos de apertura siempre. Vocabulario: electrolinera/estación de carga, cargador y conector (no "manguera" ni "pistola"), sesión de carga, kWh y kW con espacio ("22 kWh"), dinero "$ 35.000", horas "3:20 p. m.", coma decimal ("48,6 kWh").
- **App**: tema oscuro (fondo #000000, tarjetas #171717, campos #262626 con borde blanco 1 px), botón primario a lo ancho de 52 px, íconos Material Symbols Outlined. **Web y documentos**: tema claro, texto hasta 720 px de ancho.

## Cómo se aplica

| Dónde | Qué toma del manual |
|---|---|
| `apps/backoffice/src/styles.css` | Tokens CSS de color (claro y oscuro), tipografía, radios y foco; el back-office es "web" (tema claro por defecto, oscuro si el sistema lo pide) |
| `apps/backoffice/public/brand/` | `volt-logo-rojo.svg`, `volt-logo-blanco.svg`, `volt-logo-negro.svg` (copias exactas del manual) |
| `apps/backoffice/index.html` | Barlow Semi Condensed y Roboto desde Google Fonts (con reserva a Arial y Helvetica) |
| Recibos HTML (`packages/csms/src/billing/receipts.ts`) y correos | Tema claro, razón social completa, formatos de cifras y fechas del manual (se ajusta en la iteración 7 junto con el envío de correo) |
| App Volt (iteración 7) | Tema oscuro, degradado del encabezado, botón primario, pestañas, insignias de estado, textos de `docs/textos-app-conductor.md` |

Extensión propia, no del manual: el back-office necesita un tercer color de estado para alarmas de severidad WARNING (ámbar #B45309 sobre #FEF3C7 en claro; #F59E0B sobre #3B2A0A en oscuro). Solo se usa en insignias operativas, nunca en piezas de marca.
