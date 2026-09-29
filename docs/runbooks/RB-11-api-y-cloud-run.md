# RB-11. API y Cloud Run

**Alertas:** `[env] API con errores 5xx`, `[env] API consumiendo el presupuesto de error` (tasa de consumo del SLO de disponibilidad > 10 en 1 h) y `[env] api no responde desde internet`.

1. **Revisión activa:** `gcloud run services describe api --region us-central1` y Logs Explorer `resource.labels.service_name="api" severity>=ERROR`. Un 5xx con `err.code` de PostgreSQL apunta a RB-13; `ECONNREFUSED` a Redis, a RB-14; `UNAVAILABLE` del gateway, a RB-10.
2. **Reversión rápida:** `gcloud run services update-traffic api --to-revisions <revisión-anterior>=100 --region us-central1` (RB-15). Las migraciones son compatibles hacia atrás (expand/contract).
3. **Cuota y escalado:** instancias en el panel; `api_max_instances` en `envs/<env>.tfvars`. Con Cloud Armor activo, un 429 masivo por IP puede ser un cliente mal comportado o un límite demasiado bajo (`armor.tf`).
4. **Certificado o DNS:** `curl -sv https://api-<env>.supercargadores.co/healthz`; en Certificate Manager el certificado `volt-<env>-web` debe estar `ACTIVE`.
5. **Política de presupuesto de error:** si el presupuesto mensual baja del 20 %, se congelan despliegues no correctivos (OPS §2.4).

**Comprobar la API desde fuera:** flujo *Comprobación de la API* (ambiente; marcar "por el balanceador" cuando el DNS resuelva). Muestra la revisión lista, la entrada efectiva, la definición v2 del servicio y el código de `/healthz`. Las URL `*.run.app` de `api` responden 404 en el borde (punto abierto del ADR 0023); la ruta válida es `https://api[-<ambiente>].supercargadores.co`.
