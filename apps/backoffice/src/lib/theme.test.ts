import { describe, expect, it } from 'vitest';
import { applyTheme, readTheme } from './theme.ts';

describe('tema del back-office', () => {
  it('lee el tema guardado y cae en el del sistema', () => {
    expect(readTheme({ getItem: () => 'dark' })).toBe('dark');
    expect(readTheme({ getItem: () => 'azul' })).toBe('system');
    expect(readTheme(null)).toBe('system');
  });

  it('aplica el atributo y lo recuerda; sistema lo borra', () => {
    const attributes = new Map<string, string>();
    const store = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    };
    const storage = {
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    };
    applyTheme('dark', root, storage);
    expect(attributes.get('data-theme')).toBe('dark');
    expect(store.get('volt.theme')).toBe('dark');
    applyTheme('system', root, storage);
    expect(attributes.has('data-theme')).toBe(false);
    expect(store.has('volt.theme')).toBe(false);
  });
});
