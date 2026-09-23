/**
 * Lectura del QR pegado en cada conector. El QR oficial codifica la URL universal
 * `https://app.supercargadores.co/evse/<evseId>` (abre la app si está instalada); también se aceptan
 * `volt://evse/<evseId>`, `?evse=<evseId>` y el identificador a secas (p. ej. `VOLT-BOG01-CP01-1`).
 */
const EVSE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,47}$/;

export function parseEvseQr(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (EVSE_ID.test(text) && !text.includes('/') && !text.includes(':')) return text;
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get('evse') ?? url.searchParams.get('evseId');
    if (fromQuery && EVSE_ID.test(fromQuery)) return fromQuery;
    const segments = url.pathname.split('/').filter(Boolean);
    const index = segments.findIndex(
      (s) => s.toLowerCase() === 'evse' || s.toLowerCase() === 'evses',
    );
    const candidate =
      index >= 0
        ? segments[index + 1]
        : url.protocol === 'volt:'
          ? (segments[0] ?? url.hostname)
          : undefined;
    if (candidate && EVSE_ID.test(decodeURIComponent(candidate)))
      return decodeURIComponent(candidate);
    if (url.protocol === 'volt:' && url.hostname.toLowerCase() === 'evse') {
      const first = segments[0];
      if (first && EVSE_ID.test(first)) return first;
    }
  } catch {
    // no es una URL
  }
  return null;
}

/** URL universal que se imprime en el QR de un conector. */
export function evseQrUrl(evseId: string, base = 'https://app.supercargadores.co'): string {
  return `${base.replace(/\/$/, '')}/evse/${encodeURIComponent(evseId)}`;
}
