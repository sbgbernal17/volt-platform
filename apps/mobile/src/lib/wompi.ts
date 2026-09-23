/**
 * Tokenización directa contra Wompi desde la app con la llave pública (docs/proveedor/wompi.md): el
 * número de tarjeta nunca pasa por la API de Volt. Nequi se tokeniza con el celular y el conductor
 * aprueba en su app Nequi; la app sondea hasta que el token queda APPROVED.
 */
export interface WompiClientOptions {
  apiBaseUrl: string;
  publicKey: string;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

export interface CardInput {
  number: string;
  cvc: string;
  expMonth: string;
  expYear: string;
  cardHolder: string;
}

export interface CardToken {
  token: string;
  brand: string | null;
  last4: string | null;
  expMonth: string | null;
  expYear: string | null;
}

export interface NequiToken {
  token: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'ERROR';
}

export class WompiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'WompiError';
  }
}

function messagesOf(body: unknown): string | null {
  const error = (body as { error?: { messages?: Record<string, string[]>; reason?: string } })
    ?.error;
  if (!error) return null;
  const parts = Object.entries(error.messages ?? {}).map(
    ([field, texts]) => `${field}: ${texts.join(', ')}`,
  );
  return parts.length ? parts.join('; ') : (error.reason ?? null);
}

export class WompiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: WompiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async tokenizeCard(card: CardInput): Promise<CardToken> {
    const body = await this.request('POST', '/tokens/cards', {
      number: card.number.replace(/\s+/g, ''),
      cvc: card.cvc,
      exp_month: card.expMonth,
      exp_year: card.expYear,
      card_holder: card.cardHolder.trim(),
    });
    const data = (body as { data?: Record<string, unknown> }).data ?? {};
    return {
      token: String(data.id ?? ''),
      brand: (data.brand as string | undefined) ?? null,
      last4: (data.last_four as string | undefined) ?? null,
      expMonth: (data.exp_month as string | undefined) ?? null,
      expYear: (data.exp_year as string | undefined) ?? null,
    };
  }

  async tokenizeNequi(phoneNumber: string): Promise<NequiToken> {
    const body = await this.request('POST', '/tokens/nequi', {
      phone_number: phoneNumber.replace(/\D/g, ''),
    });
    return nequiOf(body);
  }

  async getNequiToken(token: string): Promise<NequiToken> {
    return nequiOf(await this.request('GET', `/tokens/nequi/${encodeURIComponent(token)}`));
  }

  /** Sondea el token de Nequi hasta que deje de estar PENDING (o venza el plazo). */
  async waitForNequi(
    token: string,
    options: {
      intervalMs?: number | undefined;
      timeoutMs?: number | undefined;
      sleep?: ((ms: number) => Promise<void>) | undefined;
    } = {},
  ): Promise<NequiToken> {
    const interval = options.intervalMs ?? 3000;
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    const sleep =
      options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let current = await this.getNequiToken(token);
    while (current.status === 'PENDING' && Date.now() < deadline) {
      await sleep(interval);
      current = await this.getNequiToken(token);
    }
    return current;
  }

  private async request(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.apiBaseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.options.publicKey}`,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new WompiError((error as Error).message, 0);
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      throw new WompiError(
        messagesOf(body) ?? `Wompi respondió ${response.status}`,
        response.status,
        body,
      );
    }
    return body;
  }
}

function nequiOf(body: unknown): NequiToken {
  const data = (body as { data?: { id?: string; status?: string } }).data ?? {};
  const status =
    data.status === 'APPROVED' || data.status === 'DECLINED' || data.status === 'ERROR'
      ? data.status
      : 'PENDING';
  return { token: String(data.id ?? ''), status };
}

/** Marca por el primer dígito (solo para mostrar mientras se escribe). */
export function cardBrand(number: string): 'VISA' | 'MASTERCARD' | 'AMEX' | null {
  const digits = number.replace(/\D/g, '');
  if (digits.startsWith('4')) return 'VISA';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'MASTERCARD';
  if (/^3[47]/.test(digits)) return 'AMEX';
  return null;
}

/** Algoritmo de Luhn (validación previa antes de enviar a Wompi). */
export function luhnValid(number: string): boolean {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
