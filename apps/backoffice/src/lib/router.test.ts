import { describe, expect, it } from 'vitest';
import { matchPath } from './router.tsx';

describe('enrutador', () => {
  it('empareja rutas exactas, con parámetros y comodín', () => {
    expect(matchPath('/', '/')).toEqual({ params: {} });
    expect(matchPath('/sites', '/sites')).toEqual({ params: {} });
    expect(matchPath('/sites', '/sites/1')).toBeNull();
    expect(matchPath('/charge-points/:id', '/charge-points/abc')).toEqual({
      params: { id: 'abc' },
    });
    expect(matchPath('/charge-points/:id', '/charge-points/abc/x')).toBeNull();
    expect(matchPath('/a/:x/b/:y', '/a/1/b/2')).toEqual({ params: { x: '1', y: '2' } });
    expect(matchPath('/docs/*', '/docs/a/b')).toEqual({ params: {} });
    expect(matchPath('/sites/:id', '/sites/con%20espacio')).toEqual({
      params: { id: 'con espacio' },
    });
  });
});
