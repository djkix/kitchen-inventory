import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@kitchen/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      // Module virtuel fourni par vite-plugin-pwa, absent de la configuration de test.
      'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/pwa-register.stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
