# 0014. Hash de la `AuthorizationKey` de los cargadores con scrypt de `node:crypto`

Fecha: 2026-09-22. Estado: aceptada.

## Contexto

SEG §2.3 y §2.8 indican que la `AuthorizationKey` (contraseña Basic Auth del perfil de seguridad 2) se guarda solo como hash y proponen Argon2id. Argon2 no está en la biblioteca estándar de Node: exige el paquete `argon2` (binario nativo, compilación en las imágenes Docker y en CI) o una implementación en WebAssembly. La regla del repositorio es no añadir dependencias sin justificación y preferir la biblioteca estándar.

## Decisión

Las credenciales de los cargadores se almacenan con **scrypt** (RFC 7914) de `node:crypto`, parámetros `N = 2^15, r = 8, p = 1`, sal aleatoria de 16 bytes y 32 bytes de salida, en formato PHC (`$scrypt$ln=15,r=8,p=1$<sal>$<hash>`), implementado en `@volt/security`. Reglas asociadas:

- La clave es aleatoria de 20 bytes (CSPRNG) en hexadecimal de 40 caracteres, única por cargador, se muestra una sola vez al emitirla y nunca se registra en logs ni en `ops.ocpp_message_log` (se enmascara).
- Las identidades desconocidas y los estados no admitidos verifican contra un hash de relleno para que el tiempo de respuesta no revele si el `chargeBoxId` existe.
- Bloqueo tras 5 fallos en 10 minutos durante 15 minutos (SEG §2.5); la clave de *bootstrap* caduca a las 24 horas sin conexión y, tras el primer uso correcto, pasa a 90 días; la rotación usa `next_key_hash` y promueve la clave nueva al primer uso (SEG §2.3).

## Alternativas consideradas

- **`argon2` (npm, nativo).** Mejor resistencia a GPU/ASIC en contraseñas de baja entropía; aquí las claves son aleatorias de 160 bits, con lo que el ataque por diccionario no aplica y la ventaja práctica es marginal. Coste: dependencia nativa en tres imágenes y en CI.
- **bcrypt.** Nativo o en JS puro; límite de 72 bytes y sin parámetro de memoria.
- **PBKDF2.** También en la biblioteca estándar, pero sin coste de memoria.

## Consecuencias

- El prefijo del formato PHC permite introducir Argon2id más adelante (por ejemplo, para contraseñas de personal en el back-office) y verificar ambos formatos durante la transición.
- El coste de scrypt (decenas de milisegundos por verificación) se paga solo en el *handshake* WebSocket, no por mensaje; una tormenta de reconexión de miles de cargadores se limita con el `backoff` por IP e identidad de SEG §2.5.
