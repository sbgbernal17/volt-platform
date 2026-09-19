# 0007. Gateway OCPP en GKE Autopilot; API, worker y back-office en Cloud Run

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

El gateway mantiene un WebSocket persistente por cargador. Cloud Run aplica su timeout de request (máximo 60 minutos) a los WebSockets y ofrece afinidad de sesión solo "best effort"; el External Application Load Balancer cierra los WebSockets activos a las 24 horas y los inactivos al vencer el backend service timeout (hechos verificados, resumen ejecutivo §7).

## Decisión

`apps/ocpp-gateway` corre en GKE Autopilot detrás del External Application Load Balancer (Gateway API, backend timeout elevado, política SSL propia con TLS 1.2 mínimo, Cloud Armor). El gateway envía ping cada 30 segundos, trata la reconexión diaria por cargador como comportamiento normal y se despliega con rolling update sin cortar la operación (cierre escalonado con código 1012). `apps/api`, `apps/worker` y `apps/backoffice` corren en Cloud Run.

## Alternativas consideradas

- Todo en Cloud Run con reconexión forzada cada menos de 60 minutos: viable, pero multiplica reconexiones y eventos falsos de offline; queda documentada en ARQ §3.3 como alternativa sin Kubernetes.
- Balanceador TCP de paso para evitar el corte de 24 horas: se pierde el WAF de capa 7; no se adopta salvo necesidad demostrada.

## Consecuencias

- El gateway expone `/healthz`, `/readyz` y `/metrics` en un puerto separado para sondas y Prometheus.
- El enrutamiento de comandos al pod que tiene la conexión usa Redis (chargeBoxId → pod) y gRPC interno (iteración 3).
