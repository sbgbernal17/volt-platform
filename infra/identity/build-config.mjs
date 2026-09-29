#!/usr/bin/env node
/**
 * Construye el cuerpo del PATCH a la API de administración de Identity Toolkit
 * (`admin/v2/projects/{proyecto}/config`) con las plantillas de correo de VOLT (iteración 9,
 * ADR 0024): remitente, asuntos y cuerpos HTML de `templates/`, y la URL propia de la página que
 * aplica los enlaces (`/auth/action` de la app web). Solo biblioteca estándar de Node; lo ejecuta el
 * flujo *Correos de identidad* y sirve para revisar el resultado en local:
 *
 *   node infra/identity/build-config.mjs --app-host app-dev.supercargadores.co
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
}
const appHost = args.get('app-host');
if (!appHost) {
  process.stderr.write(
    'Uso: build-config.mjs --app-host <host de la app web> [--admin-host <host>]\n',
  );
  process.exit(2);
}
const adminHost = args.get('admin-host') ?? appHost.replace(/^app(?=[-.])/, 'admin');

const config = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
const sendEmail = { callbackUri: `https://${appHost}${config.callbackPath}` };
const updateMask = ['notification.sendEmail.callbackUri'];
const problems = [];

for (const [name, template] of Object.entries(config.templates)) {
  const raw = readFileSync(join(here, 'templates', template.file), 'utf8');
  const body = raw.replaceAll('{{APP_HOST}}', appHost).replaceAll('{{ADMIN_HOST}}', adminHost);
  if (!body.includes('%LINK%')) problems.push(`${template.file}: falta el marcador %LINK%`);
  if (/\{\{[A-Z_]+\}\}/.test(body))
    problems.push(`${template.file}: quedan marcadores sin sustituir`);
  if (/https?:\/\/[^"' ]*(localhost|127\.0\.0\.1)/.test(body))
    problems.push(`${template.file}: enlace local`);
  sendEmail[name] = {
    senderDisplayName: config.senderDisplayName,
    subject: template.subject,
    body,
    bodyFormat: 'HTML',
    ...(config.senderLocalPart ? { senderLocalPart: config.senderLocalPart } : {}),
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
  };
  updateMask.push(`notification.sendEmail.${name}`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(1);
}

// Variante sin cuerpo HTML: Identity Platform rechaza cambiar el cuerpo de las plantillas
// (EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED) en proyectos sin esa capacidad habilitada; remitente,
// asunto y página de acción sí se aplican.
const sendEmailHeadersOnly = Object.fromEntries(
  Object.entries(sendEmail).map(([key, value]) => {
    if (typeof value !== 'object' || value === null) return [key, value];
    const { body: _body, bodyFormat: _format, ...rest } = value;
    return [key, rest];
  }),
);

process.stdout.write(
  `${JSON.stringify(
    {
      updateMask: updateMask.join(','),
      authorizedDomains: [appHost, adminHost],
      body: { notification: { sendEmail } },
      bodyHeadersOnly: { notification: { sendEmail: sendEmailHeadersOnly } },
    },
    null,
    2,
  )}\n`,
);
