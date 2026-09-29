# RB-10. Gateway OCPP caído o reiniciándose

**Alertas:** `[env] Gateway OCPP reiniciándose` (más de 3 reinicios de contenedor en 10 min) y `[env] ocpp no responde desde internet` (uptime check de `/healthz` por el balanceador). Síntoma acompañante: muchas alarmas `CHARGER_OFFLINE` a la vez y `synthetic.cycle result=error`.

1. **Estado de los pods:** `gcloud container clusters get-credentials volt-<env> --region us-central1 --dns-endpoint` y `kubectl get pods -n volt`. `CrashLoopBackOff`: `kubectl logs -n volt deploy/ocpp-gateway --previous`. Causas típicas: secreto no montado (`DATABASE_URL_FILE`), base o Redis inalcanzables (revisar RB-13/RB-14), imagen rota (volver a la anterior, RB-15).
2. **Balanceador:** `kubectl get gateway ocpp -n volt -o yaml` (condiciones `Programmed`/`Accepted`) y `kubectl get httproute ocpp -n volt`. Certificado: Consola → Certificate Manager → `volt-<env>-ocpp` debe estar `ACTIVE` (si el DNS no apunta a la IP sigue `PROVISIONING`).
3. **Capacidad:** CPU por pod en el panel; si está saturado, subir `gateway_replicas`/`gateway_cpu` en `envs/<env>.tfvars` y volver a desplegar (el HPA escala solo hasta `gateway_max_replicas`).
4. **Tormenta de reconexión** tras recuperar: es esperada (`gateway_disconnects` y `BootNotification` en masa). No desplegar nada más hasta que `ocpp_connections` se estabilice (OPS §3.9).
5. **Modo degradado:** con Redis caído los comandos fallan con 503 pero las mediciones siguen; con la base caída el gateway rechaza conexiones nuevas (registro en base) y mantiene las abiertas.
