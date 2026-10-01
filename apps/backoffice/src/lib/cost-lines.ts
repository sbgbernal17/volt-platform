/** Etiqueta de una línea de costo: el tope y el mínimo de la tarifa se nombran por su `elementRef` (ADR 0033). */
export function costLineLabel(
  line: { dimension: string; elementRef?: string | null },
  td: (key: string) => string,
): string {
  if (line.dimension === 'CAP') {
    if (line.elementRef === 'min_price') return td('sessions.cap.minPrice');
    if (line.elementRef === 'max_price') return td('sessions.cap.maxPrice');
  }
  return td(`sessions.dimension.${line.dimension}`);
}
