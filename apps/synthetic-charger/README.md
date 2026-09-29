# Cargador sintético

Un cargador OCPP 1.6J simulado (`@volt/ocpp-sim`) que vive en Cloud Run y se mantiene conectado al gateway del ambiente por `wss://` con perfil de seguridad 2, como lo haría un cargador real desde fuera. Cada `SYNTHETIC_CYCLE_MINUTES` registra una línea `synthetic.cycle` (`result` ok o error) que Cloud Monitoring convierte en el SLO de disponibilidad del gateway (OPS §2.4), y su desconexión sirve para probar la alarma de cargador fuera de línea.

- Con `DATABASE_URL` se da de alta solo: sede privada `SYNTH`, cargador `VOLT-SYNTH-<ENV>` de dos conectores DC, credencial de larga duración y ciclo de vida OPERATIONAL; nunca es visible en la app.
- Con `SYNTHETIC_API_URL`, `SYNTHETIC_ADMIN_TOKEN` (solo dev y staging) y `SYNTHETIC_SESSION_EVERY_CYCLES > 0` ejecuta además una sesión de prueba de extremo a extremo por la API de administración (`channel: TEST`).

```bash
SYNTHETIC_OCPP_URL=ws://localhost:9220/ocpp SYNTHETIC_PASSWORD=cambia-esta-clave pnpm --filter @volt/synthetic-charger start
```
