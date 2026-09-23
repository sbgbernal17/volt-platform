import type { Location } from '../api/types.ts';

export interface SiteMapProps {
  locations: Location[];
  onSelect: (location: Location) => void;
  /** Texto para la web, donde no hay mapa nativo. */
  webHint: string;
}
