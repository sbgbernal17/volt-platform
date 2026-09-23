import { defineConfig } from 'vitest/config';

// Solo módulos puros (formato, QR, cliente de Wompi, catálogo i18n): sin React Native ni Expo.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
