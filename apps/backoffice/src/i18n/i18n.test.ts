import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { es } from './es.ts';
import { translate, translateDynamic } from './index.tsx';

describe('i18n', () => {
  it('inglés cubre todas las claves del español y ninguna queda vacía', () => {
    const missing = (Object.keys(es) as (keyof typeof es)[]).filter((key) => !en[key]);
    expect(missing).toEqual([]);
    const empty = Object.entries(en).filter(([, value]) => value.trim() === '');
    expect(empty).toEqual([]);
    expect(Object.keys(en).length).toBe(Object.keys(es).length);
  });

  it('interpola parámetros y traduce claves dinámicas', () => {
    expect(translate('es', 'audit.chainBroken')).toBe('Cadena rota en el registro');
    expect(translate('en', 'status.Charging')).toBe('Charging');
    expect(translateDynamic('es', 'status.Faulted')).toBe('Con falla');
    expect(translateDynamic('es', 'status.Desconocido')).toBe('status.Desconocido');
  });
});
