import { describe, expect, it } from 'vitest';
import { resolveDriverDocument } from './identity.ts';

const none = { document_type: null, document_number: null, wants_invoice: false } as const;

describe('documento y factura electrónica en el perfil (ADR 0027)', () => {
  it('sin documento, pedir factura falla con el código propio', () => {
    expect(() => resolveDriverDocument(none, { wantsInvoice: true })).toThrow(
      expect.objectContaining({ code: 'INVOICE_DOCUMENT_REQUIRED' }),
    );
  });

  it('documento y factura en el mismo PATCH: normaliza y acepta', () => {
    expect(
      resolveDriverDocument(none, {
        documentType: 'CC',
        documentNumber: '1.020.304.050',
        wantsInvoice: true,
      }),
    ).toEqual({ documentType: 'CC', documentNumber: '1020304050', wantsInvoice: true });
  });

  it('con factura activa no se puede borrar el documento; apagándola sí', () => {
    const current = {
      document_type: 'CC',
      document_number: '1020304050',
      wants_invoice: true,
    } as const;
    expect(() =>
      resolveDriverDocument(current, { documentType: null, documentNumber: null }),
    ).toThrow(expect.objectContaining({ code: 'INVOICE_DOCUMENT_REQUIRED' }));
    expect(
      resolveDriverDocument(current, {
        documentType: null,
        documentNumber: null,
        wantsInvoice: false,
      }),
    ).toEqual({ documentType: null, documentNumber: null, wantsInvoice: false });
    expect(resolveDriverDocument(current, { phone: '+57 300 000 0000' })).toEqual({
      documentType: 'CC',
      documentNumber: '1020304050',
      wantsInvoice: true,
    });
  });

  it('tipo sin número o número sin tipo se rechaza', () => {
    expect(() => resolveDriverDocument(none, { documentType: 'CC' })).toThrow(/van juntos/);
    expect(() => resolveDriverDocument(none, { documentNumber: '123456' })).toThrow(/van juntos/);
  });
});
