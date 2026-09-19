/**
 * Dinero en enteros: importes en la unidad mínima de la moneda (BIGINT), energía en Wh,
 * tiempo en segundos. Nunca float (TAR §3.8). Las tarifas se expresan como precio por unidad
 * escalado por 10^PRICE_SCALE para conservar hasta seis decimales sin perder exactitud.
 */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

/** Decimales con los que se almacena un precio unitario (por kWh, por minuto, por sesión). */
export const PRICE_SCALE = 6;
export const PRICE_SCALE_FACTOR = 10n ** BigInt(PRICE_SCALE);

export interface CurrencyConfig {
  /** Código ISO 4217. */
  code: string;
  /** Decimales de la unidad mínima. Colombia: 0 en la práctica (pesos enteros). */
  exponent: number;
}

export const COP: CurrencyConfig = { code: 'COP', exponent: 0 };

/**
 * División entera con redondeo controlado. `HALF_UP` redondea los medios alejándose de cero;
 * `HALF_EVEN` al par más cercano; `DOWN` hacia cero; `UP` alejándose de cero.
 */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new RangeError('División por cero');
  const negative = numerator < 0n !== denominator < 0n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  let rounded = quotient;
  if (remainder !== 0n) {
    const twice = remainder * 2n;
    switch (mode) {
      case 'DOWN':
        break;
      case 'UP':
        rounded = quotient + 1n;
        break;
      case 'HALF_UP':
        if (twice >= absDen) rounded = quotient + 1n;
        break;
      case 'HALF_EVEN':
        if (twice > absDen || (twice === absDen && quotient % 2n === 1n)) rounded = quotient + 1n;
        break;
    }
  }
  return negative ? -rounded : rounded;
}

/** Convierte un texto decimal ("0.45", "1850", "-0.7455") a entero escalado por 10^scale. */
export function parseScaled(text: string, scale: number): bigint {
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new SyntaxError(`Número decimal inválido: "${text}"`);
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] ?? '0';
  const fraction = (match[3] ?? '').slice(0, scale).padEnd(scale, '0');
  const dropped = (match[3] ?? '').slice(scale);
  if (/[1-9]/.test(dropped)) {
    throw new RangeError(`"${text}" tiene más de ${scale} decimales`);
  }
  return sign * (BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction || '0'));
}

/** Formatea un entero escalado como texto decimal sin notación científica. */
export function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  const text = scale === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${text}` : text;
}

/**
 * Costo de energía: Wh × precio por kWh (escalado) -> unidad mínima de la moneda.
 * amount_minor = wh * price_scaled / (1000 * 10^PRICE_SCALE) ajustado al exponente de la moneda.
 */
export function energyCostMinor(
  wh: bigint,
  pricePerKwhScaled: bigint,
  currency: CurrencyConfig,
  mode: RoundingMode = 'HALF_UP',
): bigint {
  const numerator = wh * pricePerKwhScaled * 10n ** BigInt(currency.exponent);
  const denominator = 1000n * PRICE_SCALE_FACTOR;
  return divideRounded(numerator, denominator, mode);
}

/** Costo por tiempo: segundos × precio por minuto (escalado) -> unidad mínima. */
export function timeCostMinor(
  seconds: bigint,
  pricePerMinuteScaled: bigint,
  currency: CurrencyConfig,
  mode: RoundingMode = 'HALF_UP',
): bigint {
  const numerator = seconds * pricePerMinuteScaled * 10n ** BigInt(currency.exponent);
  const denominator = 60n * PRICE_SCALE_FACTOR;
  return divideRounded(numerator, denominator, mode);
}

/** Porcentaje (en centésimas: 1500 = 15,00 %) aplicado a un importe en unidad mínima. */
export function percentOfMinor(
  amountMinor: bigint,
  percentHundredths: bigint,
  mode: RoundingMode = 'HALF_UP',
): bigint {
  return divideRounded(amountMinor * percentHundredths, 10000n, mode);
}
