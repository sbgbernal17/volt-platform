# RB-14. Redis (Memorystore)

**Alerta:** `[env] Redis con memoria alta` (> 85 %). Redis guarda el directorio de conexiones (`cs:conn:*`, TTL 90 s), el canal de eventos y cachés: todo es reconstruible.

1. **Qué ocupa memoria:** Consola → Memorystore → `volt-<env>-redis` → métricas por tipo de clave. Claves sin TTL indican un error de la aplicación.
2. **Modo degradado si cae:** los comandos remotos fallan con 503 (la API responde `Retry-After`), el SSE sigue por el outbox y las mediciones siguen llegando (ARQ §8.1). Al volver, los pods del gateway vuelven a registrar sus conexiones en ≤ 30 s.
3. **Tamaño:** `redis_memory_gb` y `redis_tier` (`STANDARD_HA` con réplica) en `envs/<env>.tfvars`; el cambio de tamaño no reinicia en tier Standard.
4. **Mantenimiento de Google:** en Basic hay corte breve; en prod usar `STANDARD_HA`.
