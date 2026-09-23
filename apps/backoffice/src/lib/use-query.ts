import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.ts';

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | Error | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Carga datos al montar (y con `refreshMs`, periódicamente); vuelve a cargar al cambiar `deps`. */
export function useQuery<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  options: { refreshMs?: number | undefined; enabled?: boolean | undefined } = {},
): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const keyRef = useRef('');
  const depsKey = JSON.stringify(deps);
  const enabled = options.enabled ?? true;
  const refreshMs = options.refreshMs;
  const reload = useCallback(async () => {
    if (!enabled) return;
    const key = keyRef.current;
    try {
      const result = await loaderRef.current();
      if (keyRef.current !== key) return; // cambiaron las dependencias: respuesta tardía
      setData(result);
      setError(null);
    } catch (caught) {
      if (keyRef.current !== key) return;
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      if (keyRef.current === key) setLoading(false);
    }
  }, [enabled]);
  useEffect(() => {
    keyRef.current = depsKey;
    setLoading(true);
    void reload();
    if (!refreshMs) return undefined;
    const timer = window.setInterval(() => void reload(), refreshMs);
    return () => window.clearInterval(timer);
  }, [reload, depsKey, refreshMs]);
  return { data, error, loading, reload };
}

export interface MutationState {
  busy: boolean;
  error: ApiError | Error | null;
  message: string | null;
  run: <T>(action: () => Promise<T>, successMessage?: string) => Promise<T | undefined>;
  clear: () => void;
}

/** Ejecuta una acción con estado de ocupado, error y mensaje de éxito. */
export function useMutation(): MutationState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const run = useCallback(async <T>(action: () => Promise<T>, successMessage?: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  const clear = useCallback(() => {
    setError(null);
    setMessage(null);
  }, []);
  return { busy, error, message, run, clear };
}

export function errorMessage(error: ApiError | Error | null): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    const details = error.details as { issues?: { path?: unknown[]; message?: string }[] } | null;
    if (error.code === 'VALIDATION' && details?.issues?.length) {
      return `${error.message}: ${details.issues
        .map((i) => `${(i.path ?? []).join('.')} ${i.message ?? ''}`.trim())
        .join('; ')}`;
    }
    return `${error.message} (${error.code})`;
  }
  return error.message;
}
