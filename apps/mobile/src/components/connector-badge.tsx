/**
 * Insignia del estado de un conector para el conductor (handoff, sección 4): siempre palabra e
 * ícono; el color solo refuerza. "Cargando" en azul es únicamente para la sesión propia.
 */
import { useI18n } from '../i18n/index.tsx';
import { connectorVisual } from '../theme/tokens.ts';
import { Badge } from '../theme/ui.tsx';

export function ConnectorBadge({
  status,
  own = false,
  soc,
}: {
  status: string | null | undefined;
  /** Conector ocupado por la sesión de este conductor. */
  own?: boolean;
  soc?: number | null | undefined;
}) {
  const { t } = useI18n();
  const visual = own ? 'charging' : connectorVisual(status);
  switch (visual) {
    case 'available':
      return <Badge tone="success" icon="check" text={t('visual.available')} />;
    case 'occupied':
      return <Badge tone="warning" icon="schedule" text={t('visual.occupied')} />;
    case 'charging':
      return (
        <Badge
          tone="info"
          icon="bolt"
          text={
            soc === null || soc === undefined
              ? t('visual.charging')
              : t('visual.chargingSoc', { soc: Math.round(soc) })
          }
        />
      );
    case 'fault':
      return <Badge tone="danger" icon="error" text={t('visual.fault')} />;
    case 'out':
      return <Badge tone="neutral" icon="block" text={t('visual.out')} outlined />;
    default:
      return <Badge tone="neutral" icon="help-outline" text={t('visual.nodata')} dotted />;
  }
}
