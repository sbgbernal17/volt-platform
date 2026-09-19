import AjvModule, { type ValidateFunction } from 'ajv';
import draft06MetaSchema from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };
import AjvDraft04Module from 'ajv-draft-04';
import addFormatsModule from 'ajv-formats';
import { isKnownAction, OCPP16_ACTIONS } from './actions.ts';
import { type JsonSchemaObject, OCPP16_SCHEMAS } from './v16.generated.ts';

export * from './actions.ts';
export type { JsonSchemaObject } from './v16.generated.ts';

export type MessageKind = 'request' | 'response';

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

// Los tres paquetes son CommonJS con `export default`: en ESM la clase vive en `.default`.
const Ajv = AjvModule.default;
const AjvDraft04 = AjvDraft04Module.default;
const addFormats = addFormatsModule.default;

let ajvDraft04: InstanceType<typeof AjvDraft04> | undefined;
let ajvModern: InstanceType<typeof Ajv> | undefined;
const compiled = new Map<string, ValidateFunction>();

function validatorFor(schema: JsonSchemaObject): ValidateFunction {
  const isDraft04 = typeof schema.$schema === 'string' && schema.$schema.includes('draft-04');
  if (isDraft04) {
    if (!ajvDraft04) {
      ajvDraft04 = new AjvDraft04({ strict: false, allErrors: true });
      addFormats(ajvDraft04);
    }
    return ajvDraft04.compile(schema);
  }
  if (!ajvModern) {
    ajvModern = new Ajv({ strict: false, allErrors: true });
    ajvModern.addMetaSchema(draft06MetaSchema);
    addFormats(ajvModern);
  }
  return ajvModern.compile(schema);
}

function schemaKey(action: string, kind: MessageKind): string {
  return kind === 'request' ? action : `${action}Response`;
}

/** Devuelve el esquema oficial de una acción. Lanza si la acción no existe. */
export function getSchema(action: string, kind: MessageKind): JsonSchemaObject {
  const schema = OCPP16_SCHEMAS[schemaKey(action, kind)];
  if (!schema || !isKnownAction(action)) {
    throw new Error(`Acción OCPP 1.6 desconocida: ${action}`);
  }
  return schema;
}

function getValidator(action: string, kind: MessageKind): ValidateFunction {
  const key = `${action}:${kind}`;
  let fn = compiled.get(key);
  if (!fn) {
    fn = validatorFor(getSchema(action, kind));
    compiled.set(key, fn);
  }
  return fn;
}

function run(action: string, kind: MessageKind, payload: unknown): ValidationResult {
  if (!isKnownAction(action)) {
    return { ok: false, errors: [`Acción desconocida: ${action}`] };
  }
  const validate = getValidator(action, kind);
  if (validate(payload)) return { ok: true };
  const errors = (validate.errors ?? []).map((e) => {
    const where = e.instancePath === '' ? '(raíz)' : e.instancePath;
    const detail =
      e.keyword === 'additionalProperties' && typeof e.params.additionalProperty === 'string'
        ? `${e.message ?? ''}: ${e.params.additionalProperty}`
        : (e.message ?? e.keyword);
    return `${where} ${detail}`.trim();
  });
  return { ok: false, errors };
}

/** Valida el payload de un CALL (request) contra el esquema oficial. */
export function validateRequest(action: string, payload: unknown): ValidationResult {
  return run(action, 'request', payload);
}

/** Valida el payload de un CALLRESULT (response) contra el esquema oficial. */
export function validateResponse(action: string, payload: unknown): ValidationResult {
  return run(action, 'response', payload);
}

/** Compila todos los esquemas de una vez (útil al arrancar el gateway y en pruebas). */
export function precompileAll(): number {
  let count = 0;
  for (const { action } of OCPP16_ACTIONS) {
    getValidator(action, 'request');
    getValidator(action, 'response');
    count += 2;
  }
  return count;
}
