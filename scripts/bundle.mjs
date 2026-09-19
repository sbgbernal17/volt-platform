#!/usr/bin/env node
// Empaqueta una app en un único archivo ESM para la imagen de producción.
// Uso: node ../../scripts/bundle.mjs src/main.ts dist/main.mjs
import { build } from 'esbuild';

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  process.stderr.write('Uso: bundle.mjs <entrada> <salida>\n');
  process.exit(1);
}

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  logLevel: 'warning',
  // Dependencias opcionales nativas de ws: no se instalan en la imagen.
  external: ['bufferutil', 'utf-8-validate', 'pino-pretty'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
