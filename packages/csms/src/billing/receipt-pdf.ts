/**
 * Recibo de carga en PDF (ADR 0028): una página carta con el logotipo, la razón social, el número,
 * el adquiriente, la sesión, las líneas de costo, el total, el pago y la nota sobre la factura
 * electrónica. Se genera en la API con pdf-lib (JavaScript puro, sin archivos en tiempo de
 * ejecución) y las fuentes estándar Helvetica; las tipografías de marca llegarán cuando se decida
 * incorporarlas al paquete. Los textos son en español, como el recibo HTML.
 */
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { formatKwh, formatMoney } from '../drivers/push-texts.ts';
import {
  VOLT_BRAND_NAME,
  VOLT_LEGAL_NAME,
  VOLT_LOGO_HEIGHT,
  VOLT_LOGO_PATH,
  VOLT_LOGO_WIDTH,
  VOLT_RED,
} from './brand.ts';
import type { Receipt } from './receipts.ts';

export interface ReceiptPdfOptions {
  /** Zona horaria para fechas y horas (por defecto la de Colombia). */
  timezone?: string | undefined;
  legalName?: string | undefined;
}

const PAGE = { width: 612, height: 792, margin: 48 } as const;
const INK = rgb(0.043, 0.043, 0.043); // #0B0B0B
const MUTED = rgb(0.32, 0.32, 0.32);
const LINE = rgb(0.9, 0.9, 0.9);
const RED = rgb(...VOLT_RED);

function lineLabel(line: { dimension: string; elementRef: string | null }): string {
  if (line.dimension === 'CAP') {
    if (line.elementRef === 'min_price') return 'Cobro mínimo por conexión';
    if (line.elementRef === 'max_price') return 'Tope de precio';
  }
  return dimensionLabel(line.dimension);
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

function formatDateTime(value: Date | null | undefined, timezone: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

function formatClock(value: Date | null | undefined, timezone: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`;
}

function formatDecimal(value: string, maximumFractionDigits = 2): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number.toLocaleString('es-CO', { maximumFractionDigits });
}

function documentLabel(type: string | null | undefined, number: string | null | undefined): string {
  if (!type || !number) return '';
  const labels: Record<string, string> = {
    CC: 'C.C.',
    CE: 'C.E.',
    NIT: 'NIT',
    PAS: 'Pasaporte',
    PPT: 'PPT',
  };
  return `${labels[type] ?? type} ${number}`;
}

/** Texto seguro para las fuentes estándar (WinAnsi): lo que no exista se reemplaza por "?". */
function makeSafe(font: PDFFont): (value: string) => string {
  const supported = new Set(font.getCharacterSet());
  return (value: string) =>
    [...value.replace(/[\u202f\u00a0]/g, ' ')]
      .map((ch) => (supported.has(ch.codePointAt(0) ?? -1) ? ch : '?'))
      .join('');
}

class Writer {
  y: number;
  constructor(
    readonly page: PDFPage,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly safe: (value: string) => string,
  ) {
    this.y = PAGE.height - PAGE.margin;
  }
  text(
    value: string,
    options: {
      x?: number | undefined;
      size?: number | undefined;
      bold?: boolean | undefined;
      color?: ReturnType<typeof rgb> | undefined;
      align?: 'left' | 'right' | undefined;
    } = {},
  ): void {
    const font = options.bold ? this.bold : this.regular;
    const size = options.size ?? 10;
    const text = this.safe(value);
    const width = font.widthOfTextAtSize(text, size);
    const x =
      options.align === 'right'
        ? (options.x ?? PAGE.width - PAGE.margin) - width
        : (options.x ?? PAGE.margin);
    this.page.drawText(text, { x, y: this.y, size, font, color: options.color ?? INK });
  }
  line(): void {
    this.page.drawLine({
      start: { x: PAGE.margin, y: this.y },
      end: { x: PAGE.width - PAGE.margin, y: this.y },
      thickness: 0.6,
      color: LINE,
    });
  }
  down(points: number): void {
    this.y -= points;
  }
  /** Etiqueta gris a la izquierda y valor a la derecha, en una fila. */
  row(
    label: string,
    value: string,
    options: { bold?: boolean | undefined; size?: number | undefined } = {},
  ): void {
    this.text(label, { size: options.size ?? 10, color: MUTED });
    this.text(value, { size: options.size ?? 10, bold: options.bold, align: 'right' });
    this.down((options.size ?? 10) + 8);
  }
}

export async function renderReceiptPdf(
  receipt: Receipt,
  options: ReceiptPdfOptions = {},
): Promise<Uint8Array> {
  const timezone = options.timezone ?? 'America/Bogota';
  const legalName = options.legalName ?? VOLT_LEGAL_NAME;
  const { invoice, session, site, lines, payment } = receipt;
  const currency = invoice.currency;
  const buyer = (invoice.buyer_snapshot ?? {}) as {
    name?: string | null;
    email?: string | null;
    documentType?: string | null;
    documentNumber?: string | null;
  };

  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${invoice.number}`);
  doc.setAuthor(legalName);
  doc.setSubject('Recibo de carga de vehículo eléctrico');
  doc.setProducer('Volt Platform');
  doc.setCreationDate(invoice.issued_at);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const w = new Writer(page, regular, bold, makeSafe(regular));

  // Encabezado: logotipo (40 mm ≈ 113 pt) y título a la derecha.
  const logoScale = 113 / VOLT_LOGO_WIDTH;
  const logoHeight = VOLT_LOGO_HEIGHT * logoScale;
  page.drawSvgPath(VOLT_LOGO_PATH, {
    x: PAGE.margin,
    y: PAGE.height - PAGE.margin - logoHeight,
    scale: logoScale,
    color: RED,
    borderWidth: 0,
  });
  w.down(4);
  w.text('RECIBO DE CARGA', { size: 14, bold: true, align: 'right' });
  w.down(18);
  w.text(`N.º ${invoice.number}`, { size: 11, align: 'right' });
  w.down(15);
  w.text(`Emitido ${formatDateTime(invoice.issued_at, timezone)}`, {
    size: 9,
    color: MUTED,
    align: 'right',
  });
  w.y = PAGE.height - PAGE.margin - Math.max(logoHeight, 52) - 14;
  w.text(`${legalName} · ${VOLT_BRAND_NAME}`, { size: 10, bold: true });
  w.down(13);
  w.text('Servicio de carga de vehículos eléctricos', { size: 9, color: MUTED });
  w.down(18);
  w.line();
  w.down(18);

  // Adquiriente y sesión, en dos columnas.
  const left = PAGE.margin;
  const right = PAGE.width / 2 + 8;
  const top = w.y;
  w.text('Conductor', { x: left, size: 9, bold: true, color: MUTED });
  w.down(13);
  const buyerLines = [
    buyer.name ?? 'Consumidor final',
    documentLabel(buyer.documentType, buyer.documentNumber),
    buyer.email ?? '',
  ].filter((value) => value !== '');
  for (const value of buyerLines) {
    w.text(value, { x: left, size: 10 });
    w.down(13);
  }
  const leftBottom = w.y;
  w.y = top;
  w.text('Sesión de carga', { x: right, size: 9, bold: true, color: MUTED });
  w.down(13);
  const sessionLines = [
    site ? `${site.name}${site.city ? ` · ${site.city}` : ''}` : session.charge_box_id,
    site?.address ?? '',
    `Cargador ${session.charge_box_id} · conector ${session.ocpp_connector_id ?? '—'} · ${session.evse_code}`,
    `${formatDateTime(session.started_at, timezone)} a ${formatClock(session.ended_at, timezone)}`,
    `Carga ${formatDuration(session.charging_time_s)} · ocupación ${formatDuration(session.idle_time_s)}`,
    `Energía ${session.energy_wh === null ? '—' : formatKwh(Number(session.energy_wh))}`,
  ].filter((value) => value !== '');
  for (const value of sessionLines) {
    w.text(value, { x: right, size: 10 });
    w.down(13);
  }
  w.y = Math.min(leftBottom, w.y) - 10;
  w.line();
  w.down(18);

  // Tabla de líneas.
  const columns = { concept: left, quantity: 300, unit: 400, total: PAGE.width - PAGE.margin };
  w.text('Concepto', { x: columns.concept, size: 9, bold: true, color: MUTED });
  w.text('Cantidad', { x: columns.quantity, size: 9, bold: true, color: MUTED });
  w.text('Precio unitario', { x: columns.unit, size: 9, bold: true, color: MUTED });
  w.text('Importe', { x: columns.total, size: 9, bold: true, color: MUTED, align: 'right' });
  w.down(8);
  w.line();
  w.down(14);
  for (const line of lines) {
    const totalMinor = BigInt(line.amountMinor) + BigInt(line.taxMinor);
    w.text(lineLabel(line), { x: columns.concept, size: 10 });
    if (line.dimension !== 'CAP') {
      w.text(`${formatDecimal(line.quantity, 3)} ${line.unit}`, { x: columns.quantity, size: 10 });
      w.text(
        formatMoney(Math.round(Number(line.unitPrice) * 10 ** exponentOf(currency)), currency),
        { x: columns.unit, size: 10 },
      );
    }
    w.text(formatMoney(totalMinor, currency), { x: columns.total, size: 10, align: 'right' });
    w.down(16);
  }
  if (lines.length === 0) {
    w.text('Sin líneas de costo', { size: 10, color: MUTED });
    w.down(16);
  }
  w.line();
  w.down(16);
  const taxMinor = BigInt(invoice.tax_minor);
  if (taxMinor === 0n) {
    w.text('Servicio excluido de IVA.', { size: 9, color: MUTED });
    w.down(14);
  } else {
    w.row('Subtotal', formatMoney(BigInt(invoice.subtotal_minor), currency));
    w.row('Impuestos', formatMoney(taxMinor, currency));
  }
  w.text('Total', { size: 12, bold: true });
  w.text(formatMoney(BigInt(invoice.total_minor), currency), {
    size: 16,
    bold: true,
    align: 'right',
  });
  w.down(24);

  // Pago.
  const paymentText = payment
    ? `Pagado con ${payment.psp === 'WOMPI' ? 'Wompi' : payment.psp} · referencia ${payment.psp_reference ?? payment.reference ?? '—'}${payment.finalized_at ? ` · ${formatDateTime(payment.finalized_at, timezone)}` : ''}`
    : session.payment_status === 'WAIVED'
      ? 'Sin cobro (cortesía).'
      : 'Pago pendiente.';
  w.text(paymentText, { size: 10 });
  w.down(14);
  if (session.tariff_code) {
    w.text(`Tarifa ${session.tariff_code} v${session.tariff_version ?? ''}`, {
      size: 9,
      color: MUTED,
    });
    w.down(14);
  }

  // Pie: nota legal sobre la factura electrónica.
  w.y = PAGE.margin + 34;
  w.line();
  w.down(14);
  w.text(
    'Este recibo no es una factura electrónica. La factura electrónica ante la DIAN llegará a su correo cuando esté habilitada.',
    { size: 8, color: MUTED },
  );
  w.down(11);
  w.text(`${legalName} · ${VOLT_BRAND_NAME} · app.supercargadores.co`, { size: 8, color: MUTED });

  return doc.save();
}

function exponentOf(currency: string): number {
  return currency === 'COP' ? 0 : 2;
}
