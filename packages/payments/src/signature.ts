/**
 * Firma de integridad y checksum de eventos de Wompi (docs "Firma de integridad" y "Eventos"):
 * - integridad: SHA-256 de `<reference><amount_in_cents><currency>[<expiration_time>]<integrity_secret>`, hex.
 * - eventos: SHA-256 de la concatenación de los valores de `signature.properties` (en ese orden, tomados
 *   de `data`), el `timestamp` y el secreto de eventos, hex en mayúsculas; se compara sin distinguir
 *   mayúsculas y en tiempo constante.
 * Los importes de Wompi van en centavos: COP en pesos enteros se multiplica por 100.
 */
import { createHash } from 'node:crypto';
import { constantTimeEquals } from '@volt/security';

export function toCents(amountMinor: bigint, currencyExponent: number): bigint {
  if (currencyExponent === 2) return amountMinor;
  if (currencyExponent < 2) return amountMinor * 10n ** BigInt(2 - currencyExponent);
  const divisor = 10n ** BigInt(currencyExponent - 2);
  if (amountMinor % divisor !== 0n)
    throw new RangeError('El importe no se puede expresar en centavos sin pérdida');
  return amountMinor / divisor;
}

export function fromCents(amountInCents: bigint, currencyExponent: number): bigint {
  if (currencyExponent === 2) return amountInCents;
  if (currencyExponent < 2) {
    const divisor = 10n ** BigInt(2 - currencyExponent);
    // Los centavos de COP siempre son múltiplos de 100 en las transacciones de Volt; se redondea por seguridad.
    return (amountInCents + divisor / 2n) / divisor;
  }
  return amountInCents * 10n ** BigInt(currencyExponent - 2);
}

export function integritySignature(input: {
  reference: string;
  amountInCents: bigint;
  currency: string;
  expiresAt?: string | undefined;
  secret: string;
}): string {
  const parts = [input.reference, input.amountInCents.toString(), input.currency];
  if (input.expiresAt) parts.push(input.expiresAt);
  parts.push(input.secret);
  return createHash('sha256').update(parts.join('')).digest('hex');
}

export interface SignedEventShape {
  data?: unknown;
  signature?: { properties?: unknown; checksum?: unknown } | undefined;
  timestamp?: unknown;
}

/** Lee `transaction.id` y similares dentro de `data`. */
export function readProperty(data: unknown, path: string): string {
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === null || current === undefined) return '';
  return typeof current === 'string' ? current : String(current);
}

export function webhookChecksum(event: SignedEventShape, secret: string): string | null {
  const properties = event.signature?.properties;
  if (!Array.isArray(properties) || typeof event.timestamp !== 'number') return null;
  const concatenated = properties.map((p) => readProperty(event.data, String(p))).join('');
  return createHash('sha256')
    .update(`${concatenated}${event.timestamp}${secret}`)
    .digest('hex')
    .toUpperCase();
}

export function verifyWebhookChecksum(event: SignedEventShape, secret: string): boolean {
  const expected = webhookChecksum(event, secret);
  const presented = event.signature?.checksum;
  if (!expected || typeof presented !== 'string' || presented.length === 0) return false;
  return constantTimeEquals(presented.toUpperCase(), expected);
}
