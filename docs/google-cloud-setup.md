# Google Cloud: qué crear y cómo dar acceso al despliegue

Guía para el dueño del proyecto. Todo se hace desde la consola de Google Cloud y desde Cloud Shell (el ícono de terminal arriba a la derecha en la consola), sin instalar nada. No hace falta crear claves de cuentas de servicio: el despliegue desde GitHub Actions usa Workload Identity Federation (ADR 0007, SEG S8).

## 1. Cuenta y organización

- Si la empresa tiene dominio propio (por ejemplo `volt.com.co`), crea una cuenta de **Cloud Identity Free** con ese dominio (Consola → IAM y administración → Identidad y organización → Configurar). Eso crea una Organización de Google Cloud, que permite políticas de organización y separar la facturación del correo personal. Si prefieres empezar sin organización, se puede migrar después.
- Activa la verificación en dos pasos en la cuenta administradora.

## 2. Facturación y presupuesto

1. Consola → Facturación → crea una cuenta de facturación con la tarjeta de la empresa.
2. Facturación → Presupuestos y alertas → crea un presupuesto mensual (sugerido: 300 USD mientras no haya producción) con alertas al 50 %, 90 % y 100 %, enviadas a tu correo.

## 3. Proyectos

Crea tres proyectos y vincúlalos a la cuenta de facturación. Los IDs deben ser únicos en todo Google Cloud, así que añade un sufijo propio (por ejemplo, las iniciales de la empresa):

| Proyecto | ID sugerido | Uso |
|---|---|---|
| Volt dev | `volt-dev-<sufijo>` | desarrollo compartido, simuladores |
| Volt staging | `volt-staging-<sufijo>` | réplica reducida de producción, cargador real de laboratorio |
| Volt prod | `volt-prod-<sufijo>` | producción |

## 4. APIs, bucket de estado de Terraform y acceso desde GitHub Actions

Abre Cloud Shell, pega el bloque completo y cambia solo las tres primeras líneas. Repite el bloque por cada proyecto (dev, staging y prod).

```bash
# --- cambia estas tres líneas ---
PROJECT_ID="volt-dev-xxxx"              # ID del proyecto
ENV="dev"                                # dev | staging | prod
GITHUB_REPO="sbgbernal17/volt-platform"  # repositorio autorizado a desplegar
# --------------------------------
REGION="us-east1"
gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

# APIs que usa la plataforma
gcloud services enable \
  compute.googleapis.com container.googleapis.com run.googleapis.com \
  sqladmin.googleapis.com redis.googleapis.com pubsub.googleapis.com \
  secretmanager.googleapis.com cloudkms.googleapis.com artifactregistry.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com \
  monitoring.googleapis.com logging.googleapis.com cloudtrace.googleapis.com \
  certificatemanager.googleapis.com dns.googleapis.com bigquery.googleapis.com \
  cloudtasks.googleapis.com cloudscheduler.googleapis.com \
  servicenetworking.googleapis.com vpcaccess.googleapis.com \
  identitytoolkit.googleapis.com

# Bucket para el estado de Terraform (con versionado)
gcloud storage buckets create "gs://${PROJECT_ID}-tfstate" --location="$REGION" \
  --uniform-bucket-level-access
gcloud storage buckets update "gs://${PROJECT_ID}-tfstate" --versioning

# Workload Identity Federation: GitHub Actions se autentica sin claves
gcloud iam workload-identity-pools create github --location=global \
  --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc github-oidc \
  --location=global --workload-identity-pool=github --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}'"

# Cuenta de servicio que usará el despliegue (sin claves)
gcloud iam service-accounts create github-deployer --display-name="GitHub Actions deployer"
SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
for ROLE in roles/editor roles/resourcemanager.projectIamAdmin roles/iam.serviceAccountAdmin \
            roles/secretmanager.admin roles/cloudkms.admin roles/storage.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role="$ROLE" --quiet >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}"

echo "=== Valores para GitHub (no son secretos) ==="
echo "GCP_PROJECT_ID_${ENV^^}=${PROJECT_ID}"
echo "GCP_WIF_PROVIDER_${ENV^^}=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github-oidc"
echo "GCP_DEPLOYER_SA_${ENV^^}=${SA}"
```

Los roles anteriores son amplios a propósito para que Terraform pueda crear toda la infraestructura en la iteración 8; después se reducen al mínimo necesario y queda registrado como ADR.

## 5. Qué entregarme

Las tres líneas que imprime el bloque por cada proyecto (`GCP_PROJECT_ID_*`, `GCP_WIF_PROVIDER_*`, `GCP_DEPLOYER_SA_*`) no son secretos: cárgalas en GitHub como **variables** (repositorio → Settings → Secrets and variables → Actions → pestaña Variables → New repository variable) y dímelo. Con eso GitHub Actions podrá ejecutar `terraform plan` en cada pull request y `terraform apply` en `main`.

## 6. Más adelante

- **Dominio** (iteración 8): comprar o asignar el dominio y crear la zona en Cloud DNS del proyecto prod; te dejaré los registros exactos.
- **Identity Platform** (iteración 6): activar en dev y prod desde Consola → Identity Platform → Habilitar, con proveedores de correo y contraseña y, si quieres, Google; MFA TOTP para administradores.
- **Certificate Authority Service** (fase 2, perfil de seguridad 3): una CA subordinada Enterprise en prod (ADR 0005 del resumen de seguridad).
- **Secret Manager** (iteración 8): los secretos de producción (Wompi, DIAN, base de datos) se crean directamente en Consola → Seguridad → Secret Manager del proyecto prod, nunca en GitHub.

## 7. Medir la latencia desde Bogotá (opcional)

Desde un computador en Bogotá, en una terminal:

```bash
for r in us-east1 us-central1 northamerica-south1 southamerica-west1 southamerica-east1; do
  printf "%s: " "$r"; curl -s -o /dev/null -w "%{time_connect}s\n" "https://${r}-run.googleapis.com/"
done
```

Si `us-east1` no es la más rápida, me lo cuentas y ajustamos la región antes de la iteración 8.
