/**
 * Potencia por gabinete (ADR 0026). Un cargador de 180 kW entrega hasta 180 kW a un conector; si dos
 * vehículos cargan a la vez, el gabinete reparte la potencia. La regla es derivada, sin banderas: la
 * potencia está compartida cuando el gabinete tiene más de un conector y su máximo es menor que la
 * suma de lo que cada conector podría tomar por separado. Las consultas de inventario y ubicaciones
 * aplican la misma regla en SQL.
 */
export function isPowerShared(
  cabinetMaxW: number | null | undefined,
  connectorsMaxW: readonly (number | null | undefined)[],
): boolean {
  if (cabinetMaxW === null || cabinetMaxW === undefined || connectorsMaxW.length < 2) return false;
  const demand = connectorsMaxW.reduce<number>((sum, w) => sum + (w ?? cabinetMaxW), 0);
  return cabinetMaxW < demand;
}

/** Potencia (W) que recibe cada conector activo cuando el gabinete reparte entre `activeConnectors`. */
export function sharedPowerW(
  cabinetMaxW: number | null | undefined,
  activeConnectors: number,
  connectorMaxW: number,
): number {
  if (!cabinetMaxW) return connectorMaxW;
  if (activeConnectors <= 1) return Math.min(connectorMaxW, cabinetMaxW);
  return Math.min(connectorMaxW, Math.floor(cabinetMaxW / activeConnectors));
}
