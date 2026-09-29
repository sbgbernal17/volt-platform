# RB-15. Despliegue y reversión

Flujo *Despliegue* (`.github/workflows/deploy.yml`): imágenes → migraciones → Cloud Run → GKE. dev se despliega solo con cada push a `main`; staging y prod a mano con la etiqueta de imágenes ya probada (`image_tag`, promoción por etiqueta).

**Antes (OPS §4.8):** presupuesto de error > 20 %, sin `UpdateFirmware`/`SetChargingProfile` masivo en curso, ventana de bajo tráfico en prod.

**Reversión de Cloud Run:** `gcloud run services update-traffic <servicio> --to-revisions <revisión>=100 --region us-central1`, o volver a lanzar *Despliegue* con la `image_tag` anterior.

**Reversión del gateway:** `kubectl rollout undo deployment/ocpp-gateway -n volt` o *Despliegue* con la etiqueta anterior; el rolling update drena cada pod a 50 sockets/s con código 1012 y los cargadores reconectan a los pods sanos. Vigilar en el panel `gateway_disconnects` y CPU 30 minutos.

**Si el rollout del gateway no termina** (`exceeded its progress deadline`): con `maxUnavailable 0` el pod viejo sigue sirviendo hasta que el nuevo esté listo, así que no hay corte. Lanzar el flujo *Diagnóstico de GKE* (ambiente) para ver estado de pods, eventos, registros del contenedor y montaje de secretos sin entrar a la consola; las causas típicas son imagen que no arranca (registros), secretos sin montar (`secretproviderclasspodstatuses`, permisos de la cuenta `volt-gateway@`) y `/readyz` en 503 por no alcanzar Cloud SQL o Redis.

**Migraciones:** compatibles hacia atrás (expand/contract); nunca se edita una migración aplicada, se añade otra. Si el Job `migrate` falla, el flujo se detiene antes de tocar servicios: `gcloud run jobs executions list --job migrate --region us-central1` y los logs de la ejecución.
