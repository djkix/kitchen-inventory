import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // NestJS s'appuie sur emitDecoratorMetadata, qu'esbuild ne produit pas.
    swc.vite({ module: { type: 'es6' }, jsc: { transform: { decoratorMetadata: true, legacyDecorator: true } } }),
  ],
  resolve: {
    // En test, le paquet partagé est lu depuis ses sources : pas de build préalable.
    alias: { '@kitchen/shared': resolve(import.meta.dirname, '../../packages/shared/src/index.ts') },
  },
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.e2e-spec.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
