import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FAKE_ACCEPTANCE_TOKENS,
  FAKE_CARDS,
  FakeGateway,
  fromCents,
  integritySignature,
  PaymentGatewayError,
  toCents,
  verifyWebhookChecksum,
  WompiGateway,
} from './index.ts';

describe('firma de integridad e importes en centavos', () => {
  it('convierte pesos enteros a centavos y viceversa', () => {
    expect(toCents(13_500n, 0)).toBe(1_350_000n);
    expect(toCents(1_050n, 2)).toBe(1_050n);
    expect(fromCents(1_350_000n, 0)).toBe(13_500n);
    expect(fromCents(1_050n, 2)).toBe(1_050n);
  });

  it('firma <referencia><centavos><moneda><secreto> con SHA-256 en hexadecimal', () => {
    const signature = integritySignature({
      reference: 'sk8-438k4-xmxm392-sn2m',
      amountInCents: 2_490_000n,
      currency: 'COP',
      secret: 'test_integrity_nAIBuqayW70XpUqJS4qf4STYiISd89Fp',
    });
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    // Determinista: el mismo dato firma igual (el vector oficial se contrasta en la prueba contra el sandbox).
    expect(
      integritySignature({
        reference: 'sk8-438k4-xmxm392-sn2m',
        amountInCents: 2_490_000n,
        currency: 'COP',
        secret: 'test_integrity_nAIBuqayW70XpUqJS4qf4STYiISd89Fp',
      }),
    ).toBe(signature);
    expect(
      integritySignature({
        reference: 'otra',
        amountInCents: 2_490_000n,
        currency: 'COP',
        secret: 'x',
      }),
    ).not.toBe(signature);
  });
});

describe('emulador de pasarela y checksum de eventos', () => {
  it('alta de tarjeta, cobro aprobado, evento firmado, anulación y reembolso', async () => {
    const fake = new FakeGateway({ eventsSecret: 'secreto-eventos' });
    const token = fake.tokenizeCard({
      number: FAKE_CARDS.approved,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'ANA',
    });
    const source = await fake.createPaymentSource({
      type: 'CARD',
      token,
      customerEmail: 'ana@example.com',
      ...{
        acceptanceToken: FAKE_ACCEPTANCE_TOKENS.acceptanceToken,
        personalDataAuthToken: FAKE_ACCEPTANCE_TOKENS.personalDataAuthToken,
      },
    });
    expect(source).toMatchObject({
      status: 'AVAILABLE',
      type: 'CARD',
      publicData: { brand: 'VISA', last_four: '4242' },
    });
    const tx = await fake.charge({
      reference: 'VO-2026-000001-1',
      amountMinor: 13_500n,
      currency: 'COP',
      currencyExponent: 0,
      customerEmail: 'ana@example.com',
      paymentSourceId: source.id,
    });
    expect(tx).toMatchObject({
      status: 'APPROVED',
      amountMinor: 13_500n,
      paymentSourceId: source.id,
    });
    const event = fake.buildWebhookEvent(tx.id);
    expect(verifyWebhookChecksum(event as never, 'secreto-eventos')).toBe(true);
    expect(verifyWebhookChecksum(event as never, 'otro-secreto')).toBe(false);
    const parsed = fake.parseWebhook(event);
    expect(parsed).toMatchObject({
      event: 'transaction.updated',
      checksumValid: true,
      transaction: { id: tx.id, status: 'APPROVED', amountMinor: 13_500n },
    });
    const tampered = JSON.parse(JSON.stringify(event)) as {
      data: { transaction: { amount_in_cents: number } };
    };
    tampered.data.transaction.amount_in_cents = 100;
    expect(fake.parseWebhook(tampered).checksumValid).toBe(false);
    // La misma referencia no se puede cobrar dos veces.
    await expect(
      fake.charge({
        reference: 'VO-2026-000001-1',
        amountMinor: 1n,
        currency: 'COP',
        currencyExponent: 0,
        customerEmail: 'a',
        paymentSourceId: source.id,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await fake.voidTransaction(tx.id)).status).toBe('VOIDED');
    await expect(
      fake.refund({ transactionId: tx.id, amountMinor: 1n, currency: 'COP', currencyExponent: 0 }),
    ).rejects.toBeInstanceOf(PaymentGatewayError);
  });

  it('tarjeta rechazada, 3DS pendiente, transacciones asíncronas y enlace de pago', async () => {
    const fake = new FakeGateway({ asyncTransactions: true });
    const declined = fake.tokenizeCard({
      number: FAKE_CARDS.declined,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'LUIS',
    });
    const source = await fake.createPaymentSource({
      type: 'CARD',
      token: declined,
      customerEmail: 'luis@example.com',
      acceptanceToken: FAKE_ACCEPTANCE_TOKENS.acceptanceToken,
      personalDataAuthToken: FAKE_ACCEPTANCE_TOKENS.personalDataAuthToken,
    });
    const pending = await fake.charge({
      reference: 'R-1',
      amountMinor: 5_000n,
      currency: 'COP',
      currencyExponent: 0,
      customerEmail: 'luis@example.com',
      paymentSourceId: source.id,
    });
    expect(pending.status).toBe('PENDING');
    const event = fake.finalize(pending.id);
    expect(fake.parseWebhook(event).transaction?.status).toBe('DECLINED');
    expect((await fake.getTransaction(pending.id)).status).toBe('DECLINED');

    const threeDs = fake.tokenizeCard({
      number: FAKE_CARDS.approved,
      expMonth: '01',
      expYear: '31',
      cvc: '999',
      cardHolder: 'ANA 3DS',
    });
    const pendingSource = await fake.createPaymentSource({
      type: 'CARD',
      token: threeDs,
      customerEmail: 'ana@example.com',
      acceptanceToken: FAKE_ACCEPTANCE_TOKENS.acceptanceToken,
      personalDataAuthToken: FAKE_ACCEPTANCE_TOKENS.personalDataAuthToken,
    });
    expect(pendingSource).toMatchObject({
      status: 'PENDING',
      threeDs: { isThreeDs: true, currentStep: 'CHALLENGE' },
    });
    await expect(
      fake.charge({
        reference: 'R-2',
        amountMinor: 1n,
        currency: 'COP',
        currencyExponent: 0,
        customerEmail: 'a',
        paymentSourceId: pendingSource.id,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(fake.completeThreeDs(pendingSource.id).status).toBe('AVAILABLE');
    expect((await fake.getPaymentSource(pendingSource.id)).status).toBe('AVAILABLE');

    const link = await fake.createPaymentLink({
      name: 'Deuda',
      description: 'Sesión VO-1',
      amountMinor: 5_000n,
      currency: 'COP',
      currencyExponent: 0,
      reference: 'DEBT-1',
    });
    expect(link.url).toContain(link.id);
    const paid = fake.parseWebhook(fake.payLink(link.id));
    expect(paid.transaction).toMatchObject({
      status: 'APPROVED',
      paymentLinkId: link.id,
      amountMinor: 5_000n,
    });
  });

  it('rechaza tokens de aceptación distintos de los del comercio', async () => {
    const fake = new FakeGateway();
    const token = fake.tokenizeCard({
      number: FAKE_CARDS.approved,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'ANA',
    });
    await expect(
      fake.createPaymentSource({
        type: 'CARD',
        token,
        customerEmail: 'a@b.c',
        acceptanceToken: 'x',
        personalDataAuthToken: 'y',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', status: 422 });
  });
});

describe('adaptador de Wompi contra un servidor simulado', () => {
  let server: Server;
  let baseUrl = '';
  const received: {
    method: string;
    url: string;
    headers: IncomingMessage['headers'];
    body: unknown;
  }[] = [];
  let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk) => {
        raw += chunk;
      });
      request.on('end', () => {
        received.push({
          method: request.method ?? '',
          url: request.url ?? '',
          headers: request.headers,
          body: raw ? JSON.parse(raw) : null,
        });
        response.writeHead(nextResponse.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(nextResponse.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const gateway = () =>
    new WompiGateway({
      environment: 'sandbox',
      publicKey: 'pub_test_abc',
      privateKey: 'prv_test_xyz',
      integritySecret: 'test_integrity_secret',
      eventsSecret: 'test_events_secret',
      baseUrl,
      timeoutMs: 2000,
    });

  it('exige llaves del ambiente correcto', () => {
    expect(
      () =>
        new WompiGateway({
          environment: 'production',
          publicKey: 'pub_test_a',
          privateKey: 'prv_test_b',
          integritySecret: 's',
          eventsSecret: 'e',
        }),
    ).toThrow(/ambiente/);
  });

  it('obtiene los tokens de aceptación sin autenticación y crea la fuente de pago con la llave privada', async () => {
    nextResponse = {
      status: 200,
      body: {
        data: {
          presigned_acceptance: {
            acceptance_token: 'eyJ-acc',
            permalink: 'https://wompi.co/terminos',
          },
          presigned_personal_data_auth: {
            acceptance_token: 'eyJ-pd',
            permalink: 'https://wompi.co/datos',
          },
        },
      },
    };
    const tokens = await gateway().getAcceptanceTokens();
    expect(tokens).toMatchObject({ acceptanceToken: 'eyJ-acc', personalDataAuthToken: 'eyJ-pd' });
    expect(received.at(-1)).toMatchObject({ method: 'GET', url: '/merchants/pub_test_abc' });
    expect(received.at(-1)?.headers.authorization).toBeUndefined();

    nextResponse = {
      status: 201,
      body: {
        data: {
          id: 3891,
          type: 'CARD',
          status: 'AVAILABLE',
          customer_email: 'ana@example.com',
          public_data: {
            type: 'CARD',
            brand: 'VISA',
            last_four: '4242',
            exp_month: '12',
            exp_year: '30',
          },
        },
      },
    };
    const source = await gateway().createPaymentSource({
      type: 'CARD',
      token: 'tok_test_1',
      customerEmail: 'ana@example.com',
      acceptanceToken: 'eyJ-acc',
      personalDataAuthToken: 'eyJ-pd',
    });
    expect(source).toMatchObject({
      id: 3891,
      status: 'AVAILABLE',
      publicData: { last_four: '4242' },
    });
    expect(received.at(-1)).toMatchObject({
      method: 'POST',
      url: '/payment_sources',
      body: {
        type: 'CARD',
        token: 'tok_test_1',
        customer_email: 'ana@example.com',
        acceptance_token: 'eyJ-acc',
        accept_personal_auth: 'eyJ-pd',
      },
    });
    expect(received.at(-1)?.headers.authorization).toBe('Bearer prv_test_xyz');
  });

  it('cobra en centavos con la firma de integridad y normaliza la transacción', async () => {
    nextResponse = {
      status: 201,
      body: {
        data: {
          id: '1234-1700000000-1',
          status: 'PENDING',
          reference: 'VO-2026-000001-1',
          amount_in_cents: 1350000,
          currency: 'COP',
          payment_source_id: 3891,
          payment_method_type: 'CARD',
          customer_email: 'ana@example.com',
          created_at: '2026-10-06T15:00:00.000Z',
          finalized_at: null,
          status_message: null,
        },
      },
    };
    const tx = await gateway().charge({
      reference: 'VO-2026-000001-1',
      amountMinor: 13_500n,
      currency: 'COP',
      currencyExponent: 0,
      customerEmail: 'ana@example.com',
      paymentSourceId: 3891,
      installments: 1,
    });
    expect(tx).toMatchObject({
      id: '1234-1700000000-1',
      status: 'PENDING',
      amountMinor: 13_500n,
      reference: 'VO-2026-000001-1',
    });
    const body = received.at(-1)?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      amount_in_cents: 1_350_000,
      currency: 'COP',
      reference: 'VO-2026-000001-1',
      payment_source_id: 3891,
      recurrent: false,
      payment_method: { installments: 1 },
    });
    expect(body.signature).toBe(
      integritySignature({
        reference: 'VO-2026-000001-1',
        amountInCents: 1_350_000n,
        currency: 'COP',
        secret: 'test_integrity_secret',
      }),
    );
    expect(JSON.stringify(received.at(-1))).not.toContain('test_integrity_secret');
  });

  it('mapea los errores de Wompi y verifica el checksum de los eventos', async () => {
    nextResponse = {
      status: 422,
      body: { error: { type: 'INPUT_VALIDATION_ERROR', messages: { reference: ['ya existe'] } } },
    };
    await expect(gateway().getTransaction('x')).rejects.toMatchObject({
      code: 'VALIDATION',
      status: 422,
    });
    nextResponse = {
      status: 401,
      body: { error: { type: 'INVALID_ACCESS_TOKEN', reason: 'La llave no es válida' } },
    };
    await expect(gateway().getTransaction('x')).rejects.toMatchObject({ code: 'AUTH' });
    nextResponse = { status: 200, body: { data: { id: 'lnk_1' } } };
    const link = await gateway().createPaymentLink({
      name: 'Deuda',
      description: 'd',
      amountMinor: 5_000n,
      currency: 'COP',
      currencyExponent: 0,
      reference: 'DEBT-1',
    });
    expect(link.url).toBe('https://checkout.wompi.co/l/lnk_1');
    const fake = new FakeGateway({ eventsSecret: 'test_events_secret' });
    const token = fake.tokenizeCard({
      number: FAKE_CARDS.approved,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'ANA',
    });
    const source = await fake.createPaymentSource({
      type: 'CARD',
      token,
      customerEmail: 'a@b.c',
      acceptanceToken: FAKE_ACCEPTANCE_TOKENS.acceptanceToken,
      personalDataAuthToken: FAKE_ACCEPTANCE_TOKENS.personalDataAuthToken,
    });
    const tx = await fake.charge({
      reference: 'R-9',
      amountMinor: 2_000n,
      currency: 'COP',
      currencyExponent: 0,
      customerEmail: 'a@b.c',
      paymentSourceId: source.id,
    });
    const parsed = gateway().parseWebhook(fake.buildWebhookEvent(tx.id));
    expect(parsed.checksumValid).toBe(true);
    expect(parsed.transaction).toMatchObject({
      id: tx.id,
      amountMinor: 2_000n,
      status: 'APPROVED',
    });
    const unreachable = new WompiGateway({
      environment: 'sandbox',
      publicKey: 'pub_test_a',
      privateKey: 'prv_test_b',
      integritySecret: 's',
      eventsSecret: 'e',
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 500,
    });
    await expect(unreachable.getTransaction('x')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
