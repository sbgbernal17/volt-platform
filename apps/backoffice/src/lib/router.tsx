/**
 * Enrutador mínimo sobre `history.pushState` (sin dependencias): rutas con parámetros `:id`,
 * enlaces, navegación programática y consulta de la URL actual.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export interface RouteMatch {
  params: Record<string, string>;
}

/** Empareja un patrón (`/charge-points/:id`) con una ruta; `*` al final acepta cualquier resto. */
export function matchPath(pattern: string, path: string): RouteMatch | null {
  const patternParts = pattern.split('/').filter((p) => p.length > 0);
  const pathParts = path.split('/').filter((p) => p.length > 0);
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i] as string;
    if (expected === '*') return { params };
    const actual = pathParts[i];
    if (actual === undefined) return null;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return pathParts.length === patternParts.length ? { params } : null;
}

interface RouterState {
  path: string;
  search: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterState | null>(null);

function currentLocation(): { path: string; search: URLSearchParams } {
  if (typeof window === 'undefined') return { path: '/', search: new URLSearchParams() };
  return { path: window.location.pathname, search: new URLSearchParams(window.location.search) };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const onPop = () => setLocation(currentLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (options?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setLocation(currentLocation());
    window.scrollTo({ top: 0 });
  }, []);
  const value = useMemo(() => ({ ...location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterState {
  const context = useContext(RouterContext);
  if (!context) throw new Error('RouterProvider ausente');
  return context;
}

export function Link({
  to,
  children,
  className,
  title,
}: {
  to: string;
  children: ReactNode;
  className?: string | undefined;
  title?: string | undefined;
}) {
  const { navigate, path } = useRouter();
  const active = path === to || (to !== '/' && path.startsWith(`${to}/`));
  const classes = [className, active ? 'active' : undefined].filter(Boolean).join(' ');
  return (
    <a
      href={to}
      title={title}
      className={classes || undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export interface RouteDefinition {
  pattern: string;
  render: (params: Record<string, string>) => ReactNode;
}

/** Devuelve el primer elemento cuya ruta empareja, o `fallback`. */
export function Routes({ routes, fallback }: { routes: RouteDefinition[]; fallback: ReactNode }) {
  const { path } = useRouter();
  for (const route of routes) {
    const match = matchPath(route.pattern, path);
    if (match) return <>{route.render(match.params)}</>;
  }
  return <>{fallback}</>;
}
