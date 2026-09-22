/**
 * Trabajos de cobro (iteración 5, ADR 0002): cobrar sesiones liquidadas, reintentar deudas según el
 * calendario, consultar pagos pendientes sin webhook y conciliar a diario.
 */
import type { BillingService } from '@volt/csms';
import type { SchedulerLogger } from '../scheduler.ts';

export async function runBillingCycle(
  billing: BillingService,
  logger: SchedulerLogger,
): Promise<void> {
  const charged = await billing.chargePending(100);
  const retried = await billing.retryDueDebts(50);
  const polled = await billing.pollPendingPayments(50);
  if (charged.charged + charged.failed + charged.waived + retried + polled > 0) {
    logger.info({ ...charged, retried, polled }, 'ciclo de cobros');
  }
}

export async function runReconciliation(
  billing: BillingService,
  logger: SchedulerLogger,
): Promise<void> {
  const report = await billing.reconcile(new Date(Date.now() - 86_400_000));
  logger.info(
    { day: report.day, discrepancies: report.discrepancies.length, ...report.counts },
    'conciliación diaria de pagos',
  );
}
