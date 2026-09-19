import { describe, expect, it } from 'vitest';
import { registryFromJson, StaticRegistry } from './registry.ts';

describe('registro estático de cargadores', () => {
  const registry = new StaticRegistry([{ identity: 'CP001', password: 'secreto' }]);

  it('autentica solo con identidad y credencial correctas', async () => {
    expect(await registry.authenticate('CP001', Buffer.from('secreto'))).toMatchObject({
      identity: 'CP001',
      lifecycle: 'OPERATIONAL',
      tenantId: 'volt',
    });
    expect(await registry.authenticate('CP001', Buffer.from('otro'))).toBeUndefined();
    expect(await registry.authenticate('CP001', undefined)).toBeUndefined();
    expect(await registry.authenticate('CP002', Buffer.from('secreto'))).toBeUndefined();
  });

  it('se construye desde JSON y valida su forma', () => {
    const fromJson = registryFromJson(
      '[{"identity":"A","password":"p","lifecycle":"PROVISIONED"}]',
    );
    expect(fromJson.size).toBe(1);
    expect(registryFromJson(undefined).size).toBe(0);
    expect(() => registryFromJson('[{"identity":"A"}]')).toThrow(/OCPP_STATIC_REGISTRY inválido/);
  });
});
