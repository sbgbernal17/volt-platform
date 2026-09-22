/**
 * Prueba opcional contra el sandbox real de Wompi (ADR 0020). Solo corre cuando existen las llaves de
 * prueba en el entorno (en CI, los secretos WOMPI_*_TEST del repositorio): tokeniza la tarjeta de
 * prueba aprobada, crea la fuente de pago con los tokens de aceptación, cobra 1.000 COP con la firma
 * de integridad, espera el resultado y anula la transacción. Nunca imprime las llaves.
 */
import { PaymentGatewayError, WOMPI_KEY_PREFIXES, WompiGateway } from '@volt/payments';
import { describe, expect, it } from 'vitest';

const publicKey = process.env.WOMPI_PUBLIC_KEY_TEST?.trim() ?? '';
const privateKey = process.env.WOMPI_PRIVATE_KEY_TEST?.trim() ?? '';
const integritySecret = process.env.WOMPI_INTEGRITY_SECRET_TEST?.trim() ?? '';
const eventsSecret = process.env.WOMPI_EVENTS_SECRET_TEST?.trim() ?? '';
const present = Boolean(publicKey && privateKey && integritySecret && eventsSecret);
/**
 * Solo llaves del sandbox (`pub_test_…`, `prv_test_…`). Si los secretos del repositorio traen otras
 * llaves (por ejemplo, las de producción), la prueba se omite con un aviso y sin mostrar valores:
 * nunca se cobra contra producción desde una prueba.
 */
const sandboxKeys =
  publicKey.startsWith(WOMPI_KEY_PREFIXES.sandbox.public) &&
  privateKey.startsWith(WOMPI_KEY_PREFIXES.sandbox.private);
if (present && !sandboxKeys) {
  process.stderr.write(
    'WOMPI_PUBLIC_KEY_TEST y WOMPI_PRIVATE_KEY_TEST no son llaves del sandbox ' +
      `(deben empezar por ${WOMPI_KEY_PREFIXES.sandbox.public} y ${WOMPI_KEY_PREFIXES.sandbox.private}); ` +
      'prueba del sandbox de Wompi omitida\n',
  );
}
const configured = present && sandboxKeys;

describe.skipIf(!configured)('sandbox de Wompi (opcional, con llaves de prueba)', () => {
  it('tokeniza, crea la fuente de pago, cobra con firma de integridad y anula', async () => {
    const gateway = new WompiGateway({
      environment: 'sandbox',
      publicKey,
      privateKey,
      integritySecret,
      eventsSecret,
      timeoutMs: 20_000,
    });
    let token: string;
    try {
      token = await gateway.tokenizeCardForTesting({
        number: '4242424242424242',
        cvc: '123',
        expMonth: '12',
        expYear: '30',
        cardHolder: 'PRUEBA VOLT',
      });
    } catch (error) {
      if (
        error instanceof PaymentGatewayError &&
        (error.code === 'NETWORK' || error.code === 'TIMEOUT')
      ) {
        process.stderr.write(`sandbox de Wompi no accesible (${error.code}); prueba omitida\n`);
        return;
      }
      throw error;
    }
    expect(token).toMatch(/^tok_test_/);
    const acceptance = await gateway.getAcceptanceTokens();
    expect(acceptance.acceptanceToken.length).toBeGreaterThan(10);
    const source = await gateway.createPaymentSource({
      type: 'CARD',
      token,
      customerEmail: 'pruebas@supercargadores.co',
      acceptanceToken: acceptance.acceptanceToken,
      personalDataAuthToken: acceptance.personalDataAuthToken,
    });
    expect(['AVAILABLE', 'PENDING']).toContain(source.status);
    if (source.status !== 'AVAILABLE') {
      process.stderr.write(
        `fuente de pago en ${source.status} (3DS activo en el comercio); cobro omitido\n`,
      );
      return;
    }
    const reference = `VOLT-SANDBOX-${Date.now()}`;
    let transaction = await gateway.charge({
      reference,
      amountMinor: 1_000n,
      currency: 'COP',
      currencyExponent: 0,
      customerEmail: 'pruebas@supercargadores.co',
      paymentSourceId: source.id,
      installments: 1,
      recurrent: false,
    });
    expect(transaction.reference).toBe(reference);
    expect(transaction.amountMinor).toBe(1_000n);
    const deadline = Date.now() + 60_000;
    while (transaction.status === 'PENDING' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      transaction = await gateway.getTransaction(transaction.id);
    }
    expect(['APPROVED', 'DECLINED']).toContain(transaction.status);
    if (transaction.status === 'APPROVED') {
      const voided = await gateway.voidTransaction(transaction.id);
      expect(['VOIDED', 'APPROVED']).toContain(voided.status);
    }
  }, 120_000);
});
