/**
 * Errores no capturados de la app: en una app de tienda una excepción sin capturar cierra la app sin
 * dejar rastro. Aquí se describen (mensaje, pila, pantalla, plataforma y versión) y se envían a la
 * API (`POST /v1/diagnostics/client-errors`), que los registra con el evento `client.error` para
 * leerlos desde Cloud Logging. El envío es de mejor esfuerzo: nunca lanza ni bloquea.
 */
export interface ClientErrorReport {
  message: string;
  stack: string | null;
  route: string | null;
  platform: string;
  appVersion: string;
  updateId: string | null;
  fatal: boolean;
}

export interface ClientErrorContext {
  route?: string | null | undefined;
  platform: string;
  appVersion: string;
  updateId: string | null;
  fatal: boolean;
}

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/** Convierte cualquier valor lanzado en un informe acotado (sin datos personales: solo mensaje y pila). */
export function describeError(error: unknown, context: ClientErrorContext): ClientErrorReport {
  const asError = error instanceof Error ? error : null;
  const message = (asError?.message ?? (typeof error === 'string' ? error : String(error)))
    .trim()
    .slice(0, MAX_MESSAGE);
  const stack = asError?.stack ? asError.stack.slice(0, MAX_STACK) : null;
  return {
    message: message || 'Error sin mensaje',
    stack,
    route: context.route ?? null,
    platform: context.platform,
    appVersion: context.appVersion,
    updateId: context.updateId,
    fatal: context.fatal,
  };
}

/** Envía el informe a la API; devuelve false si no se pudo (sin red, API caída). */
export async function reportClientError(
  baseUrl: string,
  report: ClientErrorReport,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${baseUrl}/v1/diagnostics/client-errors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    return response.ok;
  } catch {
    return false;
  }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalHandler | undefined;
  setGlobalHandler?: (handler: GlobalHandler) => void;
}

/**
 * Engancha el manejador global de React Native (`ErrorUtils`) para informar los errores fatales
 * antes de que la app se cierre; conserva el manejador anterior. En la web no existe `ErrorUtils`.
 */
export function installGlobalErrorHandler(
  report: (error: unknown, fatal: boolean) => Promise<unknown>,
): void {
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!utils?.setGlobalHandler) return;
  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error, isFatal) => {
    void report(error, Boolean(isFatal)).finally(() => previous?.(error, isFatal));
  });
}
