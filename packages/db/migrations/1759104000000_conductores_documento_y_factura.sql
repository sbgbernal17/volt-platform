-- Documento de identidad del conductor y factura electrónica (ADR 0027). El documento es opcional,
-- como el teléfono; se vuelve obligatorio cuando el conductor pide factura electrónica (DIAN,
-- iteración 10). Tipos según la DIAN: CC, CE, NIT (con dígito de verificación), PAS y PPT.
ALTER TABLE auth.driver
  ADD COLUMN document_type text CHECK (document_type IN ('CC', 'CE', 'NIT', 'PAS', 'PPT')),
  ADD COLUMN document_number text CHECK (char_length(document_number) BETWEEN 3 AND 20),
  ADD COLUMN wants_invoice boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT driver_document_pair_chk CHECK ((document_type IS NULL) = (document_number IS NULL)),
  ADD CONSTRAINT driver_invoice_document_chk CHECK (NOT wants_invoice OR document_number IS NOT NULL);
COMMENT ON COLUMN auth.driver.document_type IS 'Tipo de documento DIAN: CC, CE, NIT, PAS, PPT';
COMMENT ON COLUMN auth.driver.document_number IS 'Número normalizado (sin puntos ni espacios; NIT con dígito de verificación)';
COMMENT ON COLUMN auth.driver.wants_invoice IS 'El conductor pide factura electrónica: exige documento';
