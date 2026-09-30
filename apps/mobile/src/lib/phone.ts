/**
 * Celular del conductor en la app (ADR 0031): validación previa al envío (la API vuelve a normalizar)
 * y formato para mostrar. Colombia por defecto: 10 dígitos que empiezan por 3.
 */
export const DEFAULT_COUNTRY_CODE = '57';

/** Devuelve el número en E.164 o null si no parece un celular válido. */
export function normalizePhoneInput(
  input: string,
  countryCode = DEFAULT_COUNTRY_CODE,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  const digits = trimmed.replace(/\D/g, '').replace(/^00/, international ? '' : '00');
  if (international) {
    if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
    if (digits.startsWith(countryCode)) {
      const national = digits.slice(countryCode.length);
      return countryCode === '57' && !/^3\d{9}$/.test(national) ? null : `+${digits}`;
    }
    return `+${digits}`;
  }
  const national =
    digits.length === 12 && digits.startsWith(countryCode) ? digits.slice(2) : digits;
  if (countryCode === '57' ? !/^3\d{9}$/.test(national) : national.length < 7) return null;
  return `+${countryCode}${national}`;
}

/** "+573001234567" → "+57 300 123 4567"; otros países se muestran tal cual. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  if (/^\+573\d{9}$/.test(e164)) {
    return `+57 ${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`;
  }
  return e164;
}

/** Agrupa lo que se va escribiendo (300 123 4567) sin tocar los números internacionales. */
export function groupPhoneInput(value: string): string {
  if (value.trim().startsWith('+')) return value.replace(/[^\d+ ]/g, '').slice(0, 18);
  const digits = value.replace(/\D/g, '').slice(0, 10);
  return digits.replace(/(\d{3})(\d{1,3})?(\d{1,4})?/, (_m, a: string, b?: string, c?: string) =>
    [a, b, c].filter(Boolean).join(' '),
  );
}
