/**
 * Genera src/v16.generated.ts a partir de schemas/v16/*.json para que los esquemas viajen
 * dentro del código (sin lecturas de disco en tiempo de ejecución y compatibles con el bundle).
 * Uso: pnpm --filter @volt/ocpp-schemas generate
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaDir = fileURLToPath(new URL('../schemas/v16/', import.meta.url));
const outFile = fileURLToPath(new URL('../src/v16.generated.ts', import.meta.url));

const files = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

const entries = files.map((file) => {
  const name = file.replace(/\.json$/, '');
  const json = JSON.parse(readFileSync(new URL(file, `file://${schemaDir}`), 'utf8'));
  return `  ${JSON.stringify(name)}: ${JSON.stringify(json)},`;
});

const header = `// Archivo generado por scripts/generate.ts a partir de schemas/v16/*.json. No editar a mano.
// Esquemas JSON oficiales de OCPP 1.6 (Open Charge Alliance), ver schemas/NOTICE.md.
/* biome-ignore-all format: archivo generado */
export type JsonSchemaObject = Record<string, unknown> & { $schema?: string };

export const OCPP16_SCHEMAS: Readonly<Record<string, JsonSchemaObject>> = {
`;

writeFileSync(outFile, `${header}${entries.join('\n')}\n};\n`);
console.log(`Generado ${outFile} con ${files.length} esquemas`);
