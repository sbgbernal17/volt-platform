# Gateway OCPP en GKE Autopilot

Manifiestos del gateway (ADR 0007 y 0023). Contienen marcadores `${VARIABLE}` que el flujo *Despliegue* rellena con las salidas de Terraform (`envsubst`) antes de `kubectl apply -k`:

| Variable | Origen |
|---|---|
| `PROJECT_ID`, `PROJECT_NUMBER`, `VOLT_ENV` | ambiente |
| `GSA_EMAIL` | cuenta de servicio `volt-gateway` (Workload Identity) |
| `IMAGE`, `TAG` | imagen publicada en Artifact Registry |
| `OCPP_HOST`, `OCPP_ADDRESS_NAME`, `OCPP_CERTIFICATE_MAP`, `OCPP_SSL_POLICY`, `OCPP_SECURITY_POLICY` | borde creado por Terraform (`terraform output gke`) |
| `GATEWAY_REPLICAS`, `GATEWAY_MAX_REPLICAS`, `GATEWAY_CPU`, `GATEWAY_MEMORY` | tamaño por ambiente (`envs/<env>.tfvars`) |

El balanceador de los cargadores lo crea el Gateway API de GKE (`gke-l7-global-external-managed`) con la IP, el certificado y las políticas que Terraform deja preparados. `policy-armor.yaml` solo se aplica cuando hay política de Cloud Armor (staging y prod).

Despliegue sin cortes (OPS §4.8): `RollingUpdate` con `maxUnavailable: 0`, `readinessProbe` a `/readyz` (devuelve 503 al drenar), `preStop` que espera a que el balanceador deje de enviar conexiones nuevas y `terminationGracePeriodSeconds: 120` para cerrar los sockets a ritmo constante con código 1012.
