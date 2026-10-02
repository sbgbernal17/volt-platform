import { describe, expect, it } from 'vitest';
import { formatAppBuild } from './app-build.ts';

const base = {
  version: '0.1.0',
  channel: 'staging',
  updateId: '17f5402d-1111-2222-3333-444444444444',
  updatedAt: new Date('2026-10-02T13:34:00.604Z'),
  embedded: false,
  updatesEnabled: true,
};

describe('versión de la app en Cuenta', () => {
  it('muestra la versión, el id corto de la actualización y su fecha en hora de Colombia', () => {
    expect(formatAppBuild(base, 'es')).toBe(
      'Versión 0.1.0 · actualización 17f5402d · 2 oct 2026, 8:34 a. m.',
    );
    expect(formatAppBuild(base, 'en')).toBe(
      'Version 0.1.0 · update 17f5402d · Oct 2, 2026, 8:34 a. m.',
    );
  });

  it('distingue el código incluido en la instalación y los entornos sin actualizaciones', () => {
    expect(formatAppBuild({ ...base, embedded: true, updateId: null, updatedAt: null }, 'es')).toBe(
      'Versión 0.1.0 · código incluido en la instalación',
    );
    expect(formatAppBuild({ ...base, updatesEnabled: false, channel: null }, 'es')).toBe(
      'Versión 0.1.0',
    );
    expect(formatAppBuild({ ...base, updatedAt: null }, 'en')).toBe(
      'Version 0.1.0 · update 17f5402d',
    );
  });
});
