import type { TransactionService } from '@volt/csms';
import type { SchedulerLogger } from '../scheduler.ts';

/** Sesiones STARTING cuyo plazo de arranque venció → EXPIRED (DAT §3.2). */
export async function expireSessionStarts(
  transactions: TransactionService,
  logger: SchedulerLogger,
): Promise<number> {
  const expired = await transactions.expireStartTimeouts();
  if (expired > 0) logger.info({ expired }, 'sesiones expiradas por plazo de arranque');
  return expired;
}

/** Transacciones activas de cargadores desconectados demasiado tiempo → cierre estimado (FUN M04). */
export async function closeOrphanTransactions(
  transactions: TransactionService,
  orphanTimeoutH: number,
  logger: SchedulerLogger,
): Promise<number> {
  const closed = await transactions.closeOrphanTransactions(orphanTimeoutH);
  if (closed > 0) logger.info({ closed, orphanTimeoutH }, 'transacciones cerradas como estimadas');
  return closed;
}
