import { randomBytes, randomUUID } from 'node:crypto';
import type { LifecycleState } from '@volt/domain';
import type { ISql } from 'postgres';

export const TOKEN_TYPES = [
  'RFID',
  'APP',
  'QR',
  'AUTOCHARGE',
  'EMAID',
  'FLEET',
  'OPERATOR',
  'TEST',
] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export interface IdTokenRow {
  id: string;
  tenant_id: string;
  driver_id: string | null;
  token: string;
  token_type: TokenType;
  parent_token: string | null;
  status: 'ACTIVE' | 'BLOCKED' | 'EXPIRED' | 'INVALID';
  valid_from: Date;
  valid_until: Date | null;
  last_used_at: Date | null;
}

/** Estados de `idTagInfo.status` de OCPP 1.6. */
export type AuthorizationStatus = 'Accepted' | 'Blocked' | 'Expired' | 'Invalid' | 'ConcurrentTx';

/**
 * idTag virtual de un solo uso (ARQ §2.4): prefijo por tipo + hexadecimal aleatorio, dentro de los
 * 20 caracteres de CiString20Type. Solo los idTag emitidos por la plataforma son válidos (SEG S4).
 */
export function generateIdTag(tokenType: TokenType): string {
  const prefix = tokenType === 'TEST' ? 'TEST' : tokenType === 'OPERATOR' ? 'OPER' : 'VOLT';
  return `${prefix}${randomBytes(8).toString('hex').toUpperCase()}`;
}

export interface IssueTokenInput {
  tenantId: string;
  tokenType: TokenType;
  driverId?: string | null;
  validUntil?: Date | null;
  token?: string;
}

export async function issueIdToken(db: ISql, input: IssueTokenInput): Promise<IdTokenRow> {
  const rows = await db<IdTokenRow[]>`
    INSERT INTO auth.id_token (id, tenant_id, driver_id, token, token_type, valid_until)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.driverId ?? null},
            ${input.token ?? generateIdTag(input.tokenType)}, ${input.tokenType}, ${input.validUntil ?? null})
    RETURNING *`;
  return rows[0] as IdTokenRow;
}

export async function findIdToken(
  db: ISql,
  tenantId: string,
  token: string,
): Promise<IdTokenRow | undefined> {
  const rows = await db<IdTokenRow[]>`
    SELECT * FROM auth.id_token WHERE tenant_id = ${tenantId} AND upper(token) = upper(${token})`;
  return rows[0];
}

export async function setTokenStatus(
  db: ISql,
  id: string,
  status: IdTokenRow['status'],
): Promise<void> {
  await db`UPDATE auth.id_token SET status = ${status} WHERE id = ${id}`;
}

export interface TokenEvaluation {
  status: AuthorizationStatus;
  token: IdTokenRow | undefined;
}

/**
 * Evalúa un idTag presentado por un cargador (Authorize o StartTransaction). Reglas: solo tokens
 * emitidos por la plataforma; en estados de comisionamiento (CONNECTED_PENDING, CONFIGURED,
 * TESTED) solo se aceptan tokens TEST (OPS §1.2); ConcurrentTx si el token ya tiene una
 * transacción activa en otro conector (DAT §5.13).
 */
export async function evaluateIdTag(
  db: ISql,
  input: {
    tenantId: string;
    chargePointId: string;
    lifecycle: LifecycleState;
    idTag: string;
    now?: Date;
  },
): Promise<TokenEvaluation> {
  const now = input.now ?? new Date();
  const token = await findIdToken(db, input.tenantId, input.idTag);
  if (!token) return { status: 'Invalid', token: undefined };
  if (token.status === 'BLOCKED') return { status: 'Blocked', token };
  if (token.status === 'INVALID') return { status: 'Invalid', token };
  if (
    token.status === 'EXPIRED' ||
    (token.valid_until && token.valid_until.getTime() < now.getTime())
  ) {
    return { status: 'Expired', token };
  }
  if (token.valid_from.getTime() > now.getTime()) return { status: 'Invalid', token };
  const billable = input.lifecycle === 'OPERATIONAL' || input.lifecycle === 'MAINTENANCE';
  if (!billable && token.token_type !== 'TEST') return { status: 'Invalid', token };
  const concurrent = await db`
    SELECT 1 FROM sessions.ocpp_transaction
    WHERE tenant_id = ${input.tenantId} AND upper(id_tag) = upper(${input.idTag}) AND state = 'ACTIVE'
      AND charge_point_id <> ${input.chargePointId}`;
  if (concurrent.length > 0) return { status: 'ConcurrentTx', token };
  return { status: 'Accepted', token };
}
