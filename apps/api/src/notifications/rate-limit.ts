/**
 * Límite de peticiones en memoria por clave (correo, conductor o IP) con ventanas deslizantes: sirve
 * para las rutas que envían correos o SMS y no deben repetirse sin control. Por instancia; en la
 * nube cada instancia de la API lleva su propia cuenta (suficiente para frenar abusos simples).
 */
export interface RateLimitRule {
  /** Peticiones permitidas en la ventana. */
  limit: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly rules: RateLimitRule[],
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Registra una petición; devuelve los segundos de espera si alguna regla la rechaza (0 = permitida). */
  hit(key: string): number {
    const now = this.clock();
    const longest = Math.max(...this.rules.map((r) => r.windowMs));
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < longest);
    for (const rule of this.rules) {
      const inWindow = recent.filter((t) => now - t < rule.windowMs);
      if (inWindow.length >= rule.limit) {
        const oldest = Math.min(...inWindow);
        return Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000));
      }
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now, longest);
    return 0;
  }

  private prune(now: number, longest: number): void {
    for (const [key, times] of this.hits) {
      const alive = times.filter((t) => now - t < longest);
      if (alive.length === 0) this.hits.delete(key);
      else this.hits.set(key, alive);
    }
  }
}
