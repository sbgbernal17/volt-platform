import { describe, expect, it } from 'vitest';
import { buildTemplatesSource } from '../../../../infra/identity/build-templates.mjs';
import { FakeEmailSender, renderEmail } from './email.ts';
import { EMAIL_TEMPLATES } from './email-templates.generated.ts';

describe('correos con la marca (ADR 0032)', () => {
  it('el módulo generado coincide con las plantillas HTML de infra/identity', async () => {
    const { readFile } = await import('node:fs/promises');
    const current = await readFile(
      new URL('./email-templates.generated.ts', import.meta.url),
      'utf8',
    );
    expect(current).toBe(buildTemplatesSource());
  });

  it('sustituye enlace, correo y host escapando el HTML y produce texto plano', async () => {
    const link = 'https://app-dev.supercargadores.co/auth/action?mode=verifyEmail&oobCode=abc<>"';
    const message = renderEmail(EMAIL_TEMPLATES['verify-email'], {
      link,
      email: 'ana@example.com',
      appHost: 'app-dev.supercargadores.co',
    });
    expect(message.subject).toBe('Confirme su correo en VOLT');
    expect(message.html).toContain(
      'href="https://app-dev.supercargadores.co/auth/action?mode=verifyEmail&amp;oobCode=abc&lt;&gt;&quot;"',
    );
    expect(message.html).toContain('https://app-dev.supercargadores.co/brand/volt-logo-blanco.png');
    expect(message.html).toContain('ana@example.com');
    expect(message.html).not.toMatch(/%LINK%|%EMAIL%|\{\{APP_HOST\}\}/);
    expect(message.html).toContain('>Confirmar correo<');
    expect(message.text).toContain(link);
    const sender = new FakeEmailSender();
    await sender.send({ ...message, to: 'ana@example.com' });
    expect(sender.sent[0]?.to).toBe('ana@example.com');
  });
});
