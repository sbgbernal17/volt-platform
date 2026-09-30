import type { Location } from '../api/types.ts';
import type { Coordinates } from '../lib/stations.ts';

export interface SiteMapProps {
  locations: Location[];
  selectedId: string | null;
  onSelect: (location: Location) => void;
  onDeselect: () => void;
  /** Ubicación del conductor (punto azul). */
  user: Coordinates | null;
  /** Punto al que centrar el mapa (cambia con "Mi ubicación" o la estación elegida). */
  focus: { coords: Coordinates; zoom: 'near' | 'wide'; key: number } | null;
  /** Texto para la web sin clave de mapas. */
  webHint: string;
}
