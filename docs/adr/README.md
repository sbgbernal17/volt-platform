# Registros de decisiones de arquitectura (ADR)

Cada decisión relevante se registra en un archivo `NNNN-titulo.md` con la plantilla del final. Los ADR 0001 a 0006 recogen las decisiones de negocio y de contexto tomadas por el dueño del proyecto; los ADR técnicos previstos en ARQ §8.1 se numeran desde 0007 (gateway OCPP en GKE Autopilot, monolito modular con gateway separado, stack TypeScript, PostgreSQL en Cloud SQL, modelo de tarifas alineado a OCPI).

| ADR | Decisión |
|---|---|
| [0001](0001-pais-de-operacion-colombia.md) | País de operación: Colombia |
| [0002](0002-pasarela-wompi-y-modelo-de-cobro.md) | Pasarela Wompi y modelo de cobro con tarjeta tokenizada al final de la carga |
| [0003](0003-parque-inicial-hardware-y-version-ocpp.md) | Parque inicial DC de 180 kW y 40 kW, OCPP 1.6J, perfil de seguridad 2 y luego 3 |
| [0004](0004-operador-unico-y-propietarios-de-sede.md) | Operador único con propietarios de sede de solo lectura en el futuro |
| [0005](0005-region-idiomas-marca-y-retencion.md) | Región us-east1, app Volt en español e inglés, retención de datos |
| [0006](0006-equipo-y-metodo-de-desarrollo.md) | Desarrollo por iteraciones con Claude Code; responsabilidades del dueño del proyecto |

```markdown
# NNNN. Título de la decisión

Fecha: AAAA-MM-DD. Estado: propuesta | aceptada | reemplazada por NNNN.

## Contexto
Qué problema se resuelve y qué restricciones aplican.

## Decisión
Qué se decidió, en una o dos frases.

## Alternativas consideradas
Opción, ventajas, desventajas.

## Consecuencias
Qué cambia, qué riesgos se asumen, qué se debe revisar después.
```
