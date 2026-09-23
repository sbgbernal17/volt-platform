/**
 * Consultas con recarga y sondeo (la app sondea la sesión en curso cada 2 s en lugar de SSE, que
 * `fetch` de React Native no transmite por partes) y mutaciones con estado.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (updater: (previous: T | undefined) => T | undefined) => void;
}

export function useQuery<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
  options: { enabled?: boolean | undefined; intervalMs?: number | undefined } = {},
): QueryState<T> {
  const enabled = options.enabled ?? true;
  const intervalMs = options.intervalMs ?? 0;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(enabled);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(0);
  const depsKey = JSON.stringify(deps);

  const run = useCallback(async () => {
    const key = ++keyRef.current;
    try {
      const result = await fetcherRef.current();
      if (key !== keyRef.current) return;
      setData(result);
      setError(undefined);
    } catch (caught) {
      if (key !== keyRef.current) return;
      setError(caught);
    } finally {
      if (key === keyRef.current) setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: depsKey resume las dependencias de la consulta
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void run();
    if (intervalMs <= 0) return;
    const timer = setInterval(() => void run(), intervalMs);
    return () => clearInterval(timer);
  }, [depsKey, enabled, intervalMs, run]);

  const update = useCallback((updater: (previous: T | undefined) => T | undefined) => {
    setData((previous) => updater(previous));
  }, []);

  return { data, error, loading, reload: run, setData: update };
}

export interface MutationState<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | undefined>;
  loading: boolean;
  error: unknown;
  reset: () => void;
}

export function useMutation<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): MutationState<TArgs, TResult> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const actionRef = useRef(action);
  actionRef.current = action;
  const run = useCallback(async (...args: TArgs) => {
    setLoading(true);
    setError(undefined);
    try {
      return await actionRef.current(...args);
    } catch (caught) {
      setError(caught);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);
  const reset = useCallback(() => setError(undefined), []);
  return { run, loading, error, reset };
}
