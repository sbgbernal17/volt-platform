/**
 * Documento de identidad del conductor (ADR 0027): tipos de la DIAN y normalización pura. El
 * documento es opcional; obligatorio cuando el conductor pide factura electrónica. El NIT se guarda
 * con su dígito de verificación (`NNNNNNNNN-D`) y se comprueba con el algoritmo de la DIAN.
 */
import { CsmsError } from '../errors.ts';

export const DRIVER_DOCUMENT_TYPES = ['CC', 'CE', 'NIT', 'PAS', 'PPT'] as const;
export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

/** Pesos de la DIAN para el dígito de verificación del NIT, de derecha a izquierda. */
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export function nitCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const digit = Number(digits[digits.length - 1 - i]);
    sum += digit * (NIT_WEIGHTS[i] ?? 0);
  }
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}

export class DocumentInvalidError extends CsmsError {
  constructor(type: DriverDocumentType, reason: string) {
    super(`Documento ${type} inválido: ${reason}`, 400, 'DOCUMENT_INVALID', { type, reason });
  }
}

/** Quita puntos, espacios y guiones; pasa a mayúsculas; valida por tipo. Devuelve el número normalizado. */
export function normalizeDriverDocument(type: DriverDocumentType, number: string): string {
  const raw = number.trim().toUpperCase();
  const compact = raw.replace(/[\s.]/g, '');
  switch (type) {
    case 'CC':
    case 'PPT': {
      const digits = compact.replace(/-/g, '');
      if (!/^[0-9]{5,10}$/.test(digits))
        throw new DocumentInvalidError(type, 'debe tener entre 5 y 10 dígitos');
      return digits;
    }
    case 'CE': {
      const digits = compact.replace(/-/g, '');
      if (!/^[0-9]{3,10}$/.test(digits))
        throw new DocumentInvalidError(type, 'debe tener entre 3 y 10 dígitos');
      return digits;
    }
    case 'PAS': {
      const value = compact.replace(/-/g, '');
      if (!/^[A-Z0-9]{5,20}$/.test(value))
        throw new DocumentInvalidError(type, 'debe tener entre 5 y 20 letras o dígitos');
      return value;
    }
    case 'NIT': {
      const match = /^([0-9]{5,15})(?:-?([0-9]))?$/.exec(compact);
      if (!match?.[1])
        throw new DocumentInvalidError(type, 'debe tener dígitos y el dígito de verificación');
      const base = match[1];
      const expected = nitCheckDigit(base);
      if (match[2] !== undefined && Number(match[2]) !== expected)
        throw new DocumentInvalidError(type, 'el dígito de verificación no coincide');
      return `${base}-${expected}`;
    }
    default:
      throw new DocumentInvalidError(type, 'tipo desconocido');
  }
}
