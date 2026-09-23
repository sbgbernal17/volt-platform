import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { es } from './es.ts';

describe('catálogos de la app', () => {
  it('inglés cubre todas las claves del español y sin claves de más', () => {
    const missing = (Object.keys(es) as (keyof typeof es)[]).filter((k) => !(k in en));
    const extra = Object.keys(en).filter((k) => !(k in es));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it('los textos siguen la voz de marca: sin signos de exclamación ni emojis', () => {
    for (const catalog of [es, en]) {
      for (const [key, text] of Object.entries(catalog)) {
        expect(text, key).not.toMatch(/[!¡]/);
        expect(text, key).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it('las plantillas usan los mismos parámetros en los dos idiomas', () => {
    const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(es) as (keyof typeof es)[]) {
      expect(params(en[key]), key).toEqual(params(es[key]));
    }
  });
});
