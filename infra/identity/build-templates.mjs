/**
 * Genera `packages/csms/src/notifications/email-templates.generated.ts` a partir de las plantillas
 * HTML de `templates/` y los asuntos de `config.json`, para que el envío propio de correos (ADR 0032)
 * use exactamente el mismo cuerpo que se propuso para Identity Platform. Solo biblioteca estándar.
 *
 *   node infra/identity/build-templates.mjs          # escribe el archivo generado
 *   node infra/identity/build-templates.mjs --check  # falla si el archivo generado está desactualizado
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(here, '../../packages/csms/src/notifications/email-templates.generated.ts');
const KINDS = {
  'verify-email': 'verifyEmailTemplate',
  'reset-password': 'resetPasswordTemplate',
};

export function buildTemplatesSource() {
  const config = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
  const entries = Object.entries(KINDS).map(([kind, key]) => {
    const template = config.templates[key];
    const html = readFileSync(join(here, 'templates', template.file), 'utf8');
    if (!html.includes('%LINK%')) throw new Error(`${template.file}: falta %LINK%`);
    return `  '${kind}': {\n    subject: ${JSON.stringify(template.subject)},\n    html: ${JSON.stringify(html)},\n  },`;
  });
  return [
    '// Archivo generado por infra/identity/build-templates.mjs a partir de infra/identity/templates.',
    '// No editar a mano: cambia la plantilla HTML y vuelve a ejecutar el script.',
    "import type { EmailTemplate, EmailTemplateKind } from './email.ts';",
    '',
    'export const EMAIL_TEMPLATES: Record<EmailTemplateKind, EmailTemplate> = {',
    ...entries,
    '};',
    '',
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = buildTemplatesSource();
  if (process.argv.includes('--check')) {
    const current = readFileSync(OUTPUT, 'utf8');
    if (current !== source) {
      process.stderr.write(
        'email-templates.generated.ts está desactualizado: ejecuta node infra/identity/build-templates.mjs\n',
      );
      process.exit(1);
    }
    process.stdout.write('email-templates.generated.ts al día\n');
  } else {
    writeFileSync(OUTPUT, source);
    process.stdout.write(`escrito ${OUTPUT}\n`);
  }
}
