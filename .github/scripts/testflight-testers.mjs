// Probadores de TestFlight: añade correos a un grupo de probadores externos de la app en App Store
// Connect con la API oficial (JWT ES256 firmado con la clave de API). Sin dependencias: Node 22.
// Entradas por variables de entorno: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_P8 (contenido del .p8,
// o su base64), CORREOS (separados por comas) y GRUPO (nombre del grupo externo; se crea si no existe).
// Con ASC_DRY_RUN=1 solo comprueba la firma del token y no llama a Apple. Nunca imprime la clave.
import { createPrivateKey, sign } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const API = 'https://api.appstoreconnect.apple.com/v1';
const keyId = process.env.ASC_KEY_ID ?? '';
const issuer = process.env.ASC_ISSUER_ID ?? '';
const p8 = process.env.ASC_PRIVATE_KEY_P8 ?? '';
const groupName = (process.env.GRUPO ?? '').trim() || 'Probadores VOLT';
const emails = [
  ...new Set(
    (process.env.CORREOS ?? '')
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ),
];
const appId = JSON.parse(readFileSync('apps/mobile/eas.json', 'utf8')).submit?.staging?.ios
  ?.ascAppId;

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}
function summary(line) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

if (!keyId || !issuer || !p8) fail('Faltan ASC_KEY_ID, ASC_ISSUER_ID o ASC_PRIVATE_KEY_P8.');
if (!appId) fail('Falta ascAppId en apps/mobile/eas.json (submit.staging.ios).');
const invalid = emails.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
if (emails.length === 0 || invalid.length > 0)
  fail(`Correos inválidos o vacíos: ${invalid.join(', ') || '(ninguno)'}`);

/** Token de la API de App Store Connect (ES256, 15 minutos). */
function makeToken() {
  const b64url = (value) => Buffer.from(value).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ iss: issuer, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }),
  );
  const pem = p8.includes('BEGIN') ? p8 : Buffer.from(p8, 'base64').toString('utf8');
  const key = createPrivateKey(pem);
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

const token = makeToken();
if (process.env.ASC_DRY_RUN) {
  console.log(
    `Token firmado (${token.length} caracteres) para la app ${appId}; correos: ${emails.join(', ')}`,
  );
  process.exit(0);
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}
const describe = (r) =>
  (r.json?.errors ?? []).map((e) => `${e.code ?? e.status}: ${e.detail ?? e.title}`).join('; ') ||
  `HTTP ${r.status}`;

// 1. El grupo externo (se crea si no existe).
const groups = await call('GET', `/apps/${appId}/betaGroups?limit=200`);
if (groups.status !== 200)
  fail(`No se pudo leer los grupos de la app ${appId}: ${describe(groups)}`);
let group = (groups.json.data ?? []).find(
  (g) => g.attributes.name.trim().toLowerCase() === groupName.toLowerCase(),
);
if (!group) {
  const created = await call('POST', '/betaGroups', {
    data: {
      type: 'betaGroups',
      attributes: {
        name: groupName,
        isInternalGroup: false,
        publicLinkEnabled: false,
        feedbackEnabled: true,
      },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    },
  });
  if (created.status !== 201)
    fail(`No se pudo crear el grupo "${groupName}": ${describe(created)}`);
  group = created.json.data;
  console.log(`::notice::Grupo externo "${groupName}" creado.`);
}
const kind = group.attributes.isInternalGroup ? 'interno' : 'externo';
console.log(`Grupo "${group.attributes.name}" (${kind}, id ${group.id}).`);

// 2. Cada correo: crear el probador dentro del grupo o, si ya existe, enlazarlo al grupo.
const results = [];
for (const email of emails) {
  const created = await call('POST', '/betaTesters', {
    data: {
      type: 'betaTesters',
      attributes: { email },
      relationships: { betaGroups: { data: [{ type: 'betaGroups', id: group.id }] } },
    },
  });
  if (created.status === 201) {
    results.push({ email, result: 'añadido' });
    continue;
  }
  const found = await call(
    'GET',
    `/betaTesters?filter[email]=${encodeURIComponent(email)}&filter[apps]=${appId}&limit=5`,
  );
  const tester = (found.json?.data ?? []).find(
    (t) => (t.attributes.email ?? '').toLowerCase() === email,
  );
  if (!tester) {
    results.push({ email, result: `error: ${describe(created)}` });
    continue;
  }
  const linked = await call('POST', `/betaGroups/${group.id}/relationships/betaTesters`, {
    data: [{ type: 'betaTesters', id: tester.id }],
  });
  results.push({
    email,
    result:
      linked.status === 204
        ? 'ya existía; enlazado al grupo'
        : `error al enlazar: ${describe(linked)}`,
  });
}

// 3. Compilaciones del grupo y últimas de la app, para saber si el probador recibirá algo.
const groupBuilds = await call('GET', `/betaGroups/${group.id}/builds?limit=5`);
const latest = await call('GET', `/apps/${appId}/builds?limit=5&sort=-uploadedDate`);
const fmt = (b) =>
  `${b.attributes.version} (${b.attributes.processingState}${b.attributes.expired ? ', vencida' : ''})`;
const inGroup = (groupBuilds.json?.data ?? []).map(fmt);
const recent = (latest.json?.data ?? []).map(fmt);

summary(`## Probadores de TestFlight · grupo "${group.attributes.name}" (${kind})`);
summary('');
summary('| Correo | Resultado |');
summary('|---|---|');
for (const r of results) summary(`| ${r.email} | ${r.result} |`);
summary('');
summary(
  `Compilaciones en el grupo: ${inGroup.join(', ') || 'ninguna'}. Últimas de la app: ${recent.join(', ') || 'ninguna'}.`,
);
for (const r of results) console.log(`${r.email}: ${r.result}`);
if (inGroup.length === 0)
  console.log(
    `::warning::El grupo no tiene compilaciones: en App Store Connect → TestFlight → "${group.attributes.name}" → Compilaciones añade la última (la primera de un grupo externo pasa por la revisión beta de Apple, normalmente 1 a 2 días); hasta entonces los probadores no reciben la invitación.`,
  );
if (results.some((r) => r.result.startsWith('error'))) process.exit(1);
