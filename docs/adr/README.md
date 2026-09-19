# Registros de decisiones de arquitectura (ADR)

Cada decisión relevante se registra en un archivo `NNNN-titulo.md` con la plantilla siguiente. Las primeras seis decisiones previstas (ARQ §8.1): gateway OCPP en GKE Autopilot, monolito modular con gateway separado, stack TypeScript, PostgreSQL en Cloud SQL, modelo de tarifas alineado a OCPI, perfil de seguridad OCPP 2 con evolución a 3.

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
