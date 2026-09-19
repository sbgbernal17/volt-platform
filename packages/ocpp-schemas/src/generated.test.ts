import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OCPP16_SCHEMAS } from './v16.generated.ts';

const schemaDir = new URL('../schemas/v16/', import.meta.url);

describe('esquemas embebidos', () => {
  it('coinciden exactamente con los archivos oficiales de schemas/v16', () => {
    const files = readdirSync(schemaDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(78);
    for (const file of files) {
      const expected = JSON.parse(readFileSync(new URL(file, schemaDir), 'utf8'));
      const name = file.replace(/\.json$/, '');
      expect(
        OCPP16_SCHEMAS[name],
        `${file} desincronizado: ejecuta pnpm --filter @volt/ocpp-schemas generate`,
      ).toEqual(expected);
    }
    expect(Object.keys(OCPP16_SCHEMAS)).toHaveLength(78);
  });
});
