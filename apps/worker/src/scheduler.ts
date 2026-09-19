/**
 * Planificador mínimo de tareas periódicas con apagado ordenado. Los trabajos reales
 * (relay del outbox, timeouts de sesión, conciliación) se registran en iteraciones posteriores.
 */
export interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

export interface SchedulerLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export class Scheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();
  private stopped = false;

  constructor(
    private readonly jobs: readonly Job[],
    private readonly logger: SchedulerLogger,
  ) {}

  start(): void {
    for (const job of this.jobs) {
      const timer = setInterval(() => void this.tick(job), job.intervalMs);
      timer.unref();
      this.timers.set(job.name, timer);
    }
    this.logger.info({ jobs: this.jobs.map((j) => j.name) }, 'worker iniciado');
  }

  /** Ejecuta un trabajo evitando solapamientos si la ejecución anterior sigue en curso. */
  async tick(job: Job): Promise<boolean> {
    if (this.stopped || this.running.has(job.name)) return false;
    this.running.add(job.name);
    try {
      await job.run();
      return true;
    } catch (error) {
      this.logger.error({ job: job.name, err: error }, 'trabajo fallido');
      return false;
    } finally {
      this.running.delete(job.name);
    }
  }

  async stop(graceMs = 10_000): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) clearInterval(timer);
    const deadline = Date.now() + graceMs;
    while (this.running.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.logger.info({ pending: [...this.running] }, 'worker detenido');
  }
}
