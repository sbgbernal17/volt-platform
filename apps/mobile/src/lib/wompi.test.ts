import { describe, expect, it } from 'vitest';
import { cardBrand, luhnValid, WompiClient, WompiError } from './wompi.ts';

describe('cliente de tokenización de Wompi', () => {
  it('tokeniza una tarjeta con la llave pública y lee los datos públicos', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          status: 'CREATED',
          data: {
            id: 'tok_test_1',
            brand: 'VISA',
            last_four: '4242',
            exp_month: '12',
            exp_year: '30',
          },
        }),
        { status: 201 },
      );
    }) as typeof fetch;
    const client = new WompiClient({
      apiBaseUrl: 'https://sandbox.wompi.co/v1/',
      publicKey: 'pub_test_x',
      fetchImpl,
    });
    const token = await client.tokenizeCard({
      number: '4242 4242 4242 4242',
      cvc: '123',
      expMonth: '12',
      expYear: '30',
      cardHolder: 'ANA PEREZ',
    });
    expect(token).toEqual({
      token: 'tok_test_1',
      brand: 'VISA',
      last4: '4242',
      expMonth: '12',
      expYear: '30',
    });
    const first = calls[0];
    expect(first?.url).toBe('https://sandbox.wompi.co/v1/tokens/cards');
    expect((first?.init.headers as Record<string, string> | undefined)?.authorization).toBe(
      'Bearer pub_test_x',
    );
    expect(JSON.parse(String(first?.init.body))).toEqual({
      number: '4242424242424242',
      cvc: '123',
      exp_month: '12',
      exp_year: '30',
      card_holder: 'ANA PEREZ',
    });
  });

  it('traduce los errores de validación y sondea Nequi hasta la aprobación', async () => {
    let nequiCalls = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith('/tokens/cards')) {
        return new Response(
          JSON.stringify({
            error: { type: 'INPUT_VALIDATION_ERROR', messages: { number: ['Debe ser numérico'] } },
          }),
          { status: 422 },
        );
      }
      if (path.endsWith('/tokens/nequi')) {
        return new Response(JSON.stringify({ data: { id: 'nequi_test_1', status: 'PENDING' } }), {
          status: 201,
        });
      }
      nequiCalls++;
      return new Response(
        JSON.stringify({
          data: { id: 'nequi_test_1', status: nequiCalls >= 2 ? 'APPROVED' : 'PENDING' },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const client = new WompiClient({
      apiBaseUrl: 'https://sandbox.wompi.co/v1',
      publicKey: 'pub_test_x',
      fetchImpl,
    });
    await expect(
      client.tokenizeCard({ number: 'x', cvc: '1', expMonth: '1', expYear: '1', cardHolder: 'a' }),
    ).rejects.toMatchObject({
      name: 'WompiError',
      status: 422,
      message: 'number: Debe ser numérico',
    });
    const pending = await client.tokenizeNequi('300 123 4567');
    expect(pending).toEqual({ token: 'nequi_test_1', status: 'PENDING' });
    const approved = await client.waitForNequi(pending.token, {
      intervalMs: 1,
      sleep: async () => undefined,
    });
    expect(approved.status).toBe('APPROVED');
    expect(nequiCalls).toBe(2);
    expect(new WompiError('x', 0)).toBeInstanceOf(Error);
  });

  it('reconoce la marca y valida con Luhn', () => {
    expect(cardBrand('4242 4242')).toBe('VISA');
    expect(cardBrand('5555 5555')).toBe('MASTERCARD');
    expect(cardBrand('3782')).toBe('AMEX');
    expect(cardBrand('9')).toBeNull();
    expect(luhnValid('4242 4242 4242 4242')).toBe(true);
    expect(luhnValid('4242 4242 4242 4241')).toBe(false);
    expect(luhnValid('123')).toBe(false);
  });
});
