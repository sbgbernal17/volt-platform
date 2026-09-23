/** En el navegador no hay mapa nativo: se muestra la indicación y la lista hace el trabajo. */
import { Notice } from '../theme/ui.tsx';
import type { SiteMapProps } from './site-map.types.ts';

export function SiteMap({ webHint }: SiteMapProps) {
  return <Notice tone="info">{webHint}</Notice>;
}
