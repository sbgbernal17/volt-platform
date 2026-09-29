# RB-01. Cargador fuera de línea

**Alerta:** `[env] Cargador fuera de línea`. El worker abrió la alarma `CHARGER_OFFLINE` (severidad WARNING; CRITICAL si ≥ 30 % de los cargadores de la sede están caídos) porque un cargador OPERATIONAL lleva más de 30 s sin socket con el gateway. Se resuelve sola cuando el cargador reconecta (`alarm.resolved`).

1. **¿Es uno o son muchos?** Back-office → Alarmas. Varios de la misma sede o de varias sedes a la vez: es red o plataforma; ir a RB-10 (gateway) y a OPS §3.9 (tormenta de reconexión). Uno solo: seguir aquí.
2. **Última conexión:** back-office → Cargadores → bitácora (`ops.charge_point_connection`: `close_code`, `close_reason`). Código 1012 = drenado por despliegue (debe reconectar en segundos); 1008 = desalojo por conexión duplicada (otra instancia con la misma identidad); sin cierre registrado = corte de red o apagado.
3. **Comprobar el borde:** `https://ocpp-<env>.supercargadores.co/healthz` responde 200. Si no, RB-10.
4. **Comprobar el cargador** (OPS §3.3): alimentación, SIM y cobertura, URL configurada (`wss://ocpp<-env>.supercargadores.co/ocpp/<chargeBoxId>`), credencial vigente (Cargadores → Credencial: `expires_at`, `locked_until`, intentos fallidos). Con la conexión rechazada por credencial, el gateway registra `ocpp_auth_rejected_total` y `ruta no permitida`/`credencial inválida` en el log.
5. **Con sesión en curso:** OCPP 1.6 encola `MeterValues` y `StopTransaction` hasta reconectar; el worker cierra la transacción como estimada tras `WORKER_ORPHAN_TIMEOUT_H` (12 h). No detener a mano antes.
6. **Visita a campo** si no reconecta en el plazo del SLA (P2: < 4 h en horario); anotar en la bitácora del cargador y, si hubo silencio de mantenimiento, programarlo (FUN M10).
