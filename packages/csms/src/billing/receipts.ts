/**
 * Recibos por sesión (FUN M06, TAR §3.9): una fila en `billing.invoice` de tipo RECEIPT numerada con
 * el número de sesión, con los totales, el desglose de impuestos y los datos del conductor
 * congelados. La factura electrónica DIAN llega por el puerto `EInvoicingProvider` (sin adaptador).
 */
import { randomUUID } from 'node:crypto';
import { formatScaled } from '@volt/domain';
import type { ISql } from 'postgres';
import { NotFoundError } from '../errors.ts';
import { type CostLineJson, type CostLineRow, toLineJson } from '../pricing/pricing-service.ts';
import { currencyExponent } from '../pricing/snapshot.ts';
import { appendEvent } from '../sessions/outbox.ts';
import type { ChargingSessionRow } from '../sessions/rows.ts';
import { getSessionView, type SessionView } from '../sessions/views.ts';
import { toJson } from '../types.ts';
import type { InvoiceRow, PaymentRow } from './rows.ts';

/** Puerto de facturación electrónica (DIAN): se implementa en una iteración posterior (ADR 0001). */
export interface EInvoicingProvider {
  readonly provider: string;
  issue(receipt: InvoiceRow): Promise<{ status: string; reference: string | null }>;
}

export const noEInvoicing: EInvoicingProvider = {
  provider: 'NONE',
  issue: async () => ({ status: 'NOT_CONFIGURED', reference: null }),
};

export async function issueReceipt(
  db: ISql,
  session: ChargingSessionRow,
  chargeBoxId: string,
): Promise<InvoiceRow> {
  if (session.receipt_id) {
    const existing = await db<
      InvoiceRow[]
    >`SELECT * FROM billing.invoice WHERE id = ${session.receipt_id}`;
    if (existing[0]) return existing[0];
  }
  const driver = session.driver_id
    ? (
        await db<{ email: string | null; display_name: string | null; phone: string | null }[]>`
        SELECT email, display_name, phone FROM auth.driver WHERE id = ${session.driver_id}`
      )[0]
    : undefined;
  const breakdown = session.final_calc_id
    ? await db<{ tax_rate: string; base_minor: bigint; tax_minor: bigint }[]>`
        SELECT tax_rate::text AS tax_rate, sum(amount_minor)::bigint AS base_minor, sum(tax_minor)::bigint AS tax_minor
        FROM tariffs.session_cost_line WHERE calc_id = ${session.final_calc_id} AND tax_minor <> 0
        GROUP BY tax_rate ORDER BY tax_rate`
    : [];
  const currency = session.currency ?? 'COP';
  const rows = await db<InvoiceRow[]>`
    INSERT INTO billing.invoice
      (id, tenant_id, driver_id, series, number, kind, currency, subtotal_minor, tax_minor, total_minor, tax_breakdown, buyer_snapshot, session_ids)
    VALUES (${randomUUID()}, ${session.tenant_id}, ${session.driver_id}, 'R', ${session.session_no}, 'RECEIPT', ${currency},
            ${String(session.subtotal_minor ?? 0n)}::bigint, ${String(session.tax_minor ?? 0n)}::bigint, ${String(session.total_minor ?? 0n)}::bigint,
            ${toJson(
              db as never,
              breakdown.map((b) => ({
                rate: b.tax_rate,
                base_minor: String(b.base_minor),
                tax_minor: String(b.tax_minor),
              })),
            )},
            ${toJson(db as never, { email: driver?.email ?? null, name: driver?.display_name ?? null, phone: driver?.phone ?? null })},
            ${[session.id]}::uuid[])
    ON CONFLICT (tenant_id, series, number) DO UPDATE SET issued_at = billing.invoice.issued_at
    RETURNING *`;
  const receipt = rows[0] as InvoiceRow;
  await db`UPDATE sessions.charging_session SET receipt_id = ${receipt.id}, updated_at = now() WHERE id = ${session.id} AND receipt_id IS NULL`;
  if (!session.receipt_id) {
    await appendEvent(db, {
      name: 'invoice.issued',
      tenantId: session.tenant_id,
      aggregate: { type: 'invoice', id: receipt.id },
      orderingKey: chargeBoxId,
      payload: {
        invoiceId: receipt.id,
        kind: 'RECEIPT',
        number: receipt.number,
        sessionIds: receipt.session_ids,
        totalMinor: String(receipt.total_minor),
        currency: receipt.currency,
        pdfUri: null,
      },
    });
  }
  return receipt;
}

export interface Receipt {
  invoice: InvoiceRow;
  session: SessionView;
  lines: CostLineJson[];
  payment: PaymentRow | null;
  totals: { currency: string; subtotal: string; tax: string; total: string; taxIncluded: boolean };
}

export async function getReceipt(db: ISql, sessionId: string): Promise<Receipt> {
  const session = await getSessionView(db, sessionId);
  if (!session.receipt_id) throw new NotFoundError('receipt', sessionId);
  const invoices = await db<
    InvoiceRow[]
  >`SELECT * FROM billing.invoice WHERE id = ${session.receipt_id}`;
  const invoice = invoices[0];
  if (!invoice) throw new NotFoundError('receipt', sessionId);
  const exponent = currencyExponent(invoice.currency);
  const lines = session.final_calc_id
    ? await db<
        CostLineRow[]
      >`SELECT * FROM tariffs.session_cost_line WHERE calc_id = ${session.final_calc_id} ORDER BY seq`
    : [];
  const payments = await db<PaymentRow[]>`
    SELECT * FROM billing.payment WHERE session_id = ${sessionId} AND status = 'SUCCEEDED' AND kind IN ('CAPTURE','DEBT')
    ORDER BY created_at DESC LIMIT 1`;
  return {
    invoice,
    session,
    lines: lines.map((l) => toLineJson(l, exponent)),
    payment: payments[0] ?? null,
    totals: {
      currency: invoice.currency,
      subtotal: formatScaled(BigInt(invoice.subtotal_minor), exponent),
      tax: formatScaled(BigInt(invoice.tax_minor), exponent),
      total: formatScaled(BigInt(invoice.total_minor), exponent),
      taxIncluded: session.tax_included ?? true,
    },
  };
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Recibo HTML autocontenido (sin recursos externos), en español. */
export function renderReceiptHtml(receipt: Receipt): string {
  const { invoice, session, lines, totals, payment } = receipt;
  const fmt = (value: string) =>
    `${totals.currency} ${Number(value).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;
  const rows = lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(dimensionLabel(l.dimension))}</td><td>${escapeHtml(l.quantity)} ${escapeHtml(l.unit)}</td><td>${escapeHtml(l.unitPrice)}</td><td class="n">${escapeHtml(fmt(l.total))}</td></tr>`,
    )
    .join('');
  const taxLine =
    BigInt(invoice.tax_minor) === 0n
      ? '<p class="muted">Servicio excluido de IVA.</p>'
      : `<p>Impuestos incluidos: ${escapeHtml(fmt(totals.tax))}</p>`;
  const paymentLine = payment
    ? `<p>Pagado con ${escapeHtml(payment.psp)} · referencia ${escapeHtml(payment.psp_reference ?? payment.reference ?? '')}</p>`
    : session.payment_status === 'WAIVED'
      ? '<p>Sin cobro (cortesía).</p>'
      : '<p>Pago pendiente.</p>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recibo ${escapeHtml(invoice.number)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#111}table{width:100%;border-collapse:collapse}td,th{padding:.4rem;border-bottom:1px solid #ddd;text-align:left}td.n,th.n{text-align:right}.muted{color:#666}.total{font-size:1.25rem;font-weight:600}</style></head>
<body><h1>Recibo ${escapeHtml(invoice.number)}</h1>
<p>Volt · ${escapeHtml(session.charge_box_id)} conector ${escapeHtml(session.ocpp_connector_id ?? '')} · EVSE ${escapeHtml(session.evse_code)}</p>
<p>Inicio ${escapeHtml(session.started_at?.toISOString() ?? '')} · Fin ${escapeHtml(session.ended_at?.toISOString() ?? '')} · Energía ${escapeHtml(session.energy_wh === null ? '' : (Number(session.energy_wh) / 1000).toFixed(3))} kWh</p>
<table><thead><tr><th>Concepto</th><th>Cantidad</th><th>Precio</th><th class="n">Importe</th></tr></thead><tbody>${rows}</tbody></table>
${taxLine}
<p class="total">Total ${escapeHtml(fmt(totals.total))}</p>
${paymentLine}
<p class="muted">Tarifa ${escapeHtml(session.tariff_code ?? '')} v${escapeHtml(session.tariff_version ?? '')} · emitido ${escapeHtml(invoice.issued_at.toISOString())}</p>
</body></html>`;
}

function dimensionLabel(dimension: string): string {
  switch (dimension) {
    case 'ENERGY':
      return 'Energía';
    case 'PARKING_TIME':
      return 'Ocupación';
    case 'TIME':
      return 'Tiempo de carga';
    case 'FLAT':
      return 'Cargo por sesión';
    case 'ADJUSTMENT':
      return 'Ajuste';
    case 'CAP':
      return 'Tope';
    default:
      return dimension;
  }
}
