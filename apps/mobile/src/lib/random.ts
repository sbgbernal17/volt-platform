/**
 * Identificadores aleatorios para claves de idempotencia. En el navegador usa Web Crypto; en la app
 * nativa (Hermes) no existe `crypto`, así que cae en `Math.random`: la clave solo necesita ser única
 * por intento, no secreta. Antes la pantalla del cargador llamaba a `crypto.getRandomValues` al
 * dibujarse y la app de iOS y Android se cerraba al abrirla.
 */
export function randomKey(bytesLength = 16): string {
  const bytes = new Uint8Array(bytesLength);
  const webCrypto = (
    globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => unknown } }
  ).crypto;
  if (typeof webCrypto?.getRandomValues === 'function') {
    try {
      webCrypto.getRandomValues(bytes);
    } catch {
      fillWithMathRandom(bytes);
    }
  } else {
    fillWithMathRandom(bytes);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fillWithMathRandom(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
}
