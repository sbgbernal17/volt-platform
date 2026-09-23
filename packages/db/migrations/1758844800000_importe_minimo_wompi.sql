-- ============================================================
-- Importe mínimo de cobro: Wompi rechaza transacciones por debajo de 1.500 COP (validación del
-- sandbox, 23-09-2026). Por debajo de ese importe la sesión se condona (WAIVED, motivo IMPORTE_MINIMO)
-- en lugar de generar un cobro fallido y una deuda. El valor sigue siendo un parámetro (ADR 0020).
-- ============================================================
UPDATE config.param_definition
SET default_value = '1500',
    description = 'Importe mínimo que se cobra (unidad mínima, COP); por debajo la sesión se condona (WAIVED). Wompi no acepta transacciones menores de 1.500 COP'
WHERE key = 'billing.min_charge_minor';
