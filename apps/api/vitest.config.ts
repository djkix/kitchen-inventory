import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // NestJS s'appuie sur emitDecoratorMetadata, qu'esbuild ne produit pas.
    swc.vite({ module: { type: 'es6' }, jsc: { transform: { decoratorMetadata: true, legacyDecorator: true } } }),
  ],
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.e2e-spec.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
