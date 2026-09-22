/** Errores de negocio con código HTTP sugerido para la API. */
export class CsmsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends CsmsError {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} no existe`, 404, 'NOT_FOUND', { entity, id });
  }
}

export class ConflictError extends CsmsError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(message, 409, code, details);
  }
}

export class ValidationError extends CsmsError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION', details);
  }
}

export class ChargePointOfflineError extends CsmsError {
  constructor(chargeBoxId: string, description?: string) {
    super(
      `El cargador ${chargeBoxId} no está conectado${description ? `: ${description}` : ''}`,
      409,
      'CHARGER_OFFLINE',
      { chargeBoxId },
    );
  }
}
