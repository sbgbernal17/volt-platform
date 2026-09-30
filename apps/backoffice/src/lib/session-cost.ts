/**
 * Resumen del costo de una sesión para el detalle del back-office. La API devuelve un envoltorio
 * (`running` mientras la sesión está abierta, `final` cuando quedó liquidada); la pantalla muestra
 * uno u otro con la misma forma y nunca supone que existan líneas o banderas.
 */
import type { CostLineJson, SessionCostView } from './types.ts';

export interface CostSummary {
  kind: 'final' | 'running' | 'none';
  currency: string;
  lines: CostLineJson[];
  subtotalMinor: string | null;
  discountMinor: string | null;
  taxMinor: string | null;
  totalMinor: string | null;
  capped: boolean;
  flags: string[];
  alerts: string[];
  computedAt: string | null;
}

export function summarizeCost(view: SessionCostView): CostSummary {
  const currency = view.currency ?? view.final?.currency ?? view.running?.currency ?? 'COP';
  if (view.final) {
    const final = view.final;
    return {
      kind: 'final',
      currency: final.currency ?? currency,
      lines: final.lines ?? [],
      subtotalMinor: final.subtotalMinor ?? null,
      discountMinor: final.discountMinor ?? null,
      taxMinor: final.taxMinor ?? null,
      totalMinor: final.totalMinor ?? null,
      capped: Boolean(final.capped),
      flags: final.flags ?? [],
      alerts: final.alerts ?? [],
      computedAt: final.computedAt ?? null,
    };
  }
  if (view.running) {
    const running = view.running;
    return {
      kind: 'running',
      currency: running.currency ?? currency,
      lines: [],
      subtotalMinor: running.subtotal_minor ?? null,
      discountMinor: running.discount_minor ?? null,
      taxMinor: running.tax_minor ?? null,
      totalMinor: running.total_minor ?? null,
      capped: (running.flags ?? []).includes('EXPOSURE_CAP'),
      flags: running.flags ?? [],
      alerts: running.alerts ?? [],
      computedAt: running.computed_at ?? null,
    };
  }
  return {
    kind: 'none',
    currency,
    lines: [],
    subtotalMinor: null,
    discountMinor: null,
    taxMinor: null,
    totalMinor: null,
    capped: false,
    flags: [],
    alerts: [],
    computedAt: null,
  };
}
