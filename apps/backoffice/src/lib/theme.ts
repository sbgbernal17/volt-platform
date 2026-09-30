/**
 * Tema del back-office (ADR 0030): "sistema" por defecto, como pide el manual de marca para la web;
 * "oscuro" reproduce la paleta de la app. Se guarda en localStorage y `public/theme.js` lo aplica
 * antes del primer pintado.
 */
export type Theme = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'volt.theme';
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export function readTheme(storage: Pick<Storage, 'getItem'> | null): Theme {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Aplica el tema al documento y lo recuerda; `system` borra el atributo y el valor guardado. */
export function applyTheme(
  theme: Theme,
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    if (theme === 'system') storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // sin almacenamiento: el tema vive solo en la página
  }
}
