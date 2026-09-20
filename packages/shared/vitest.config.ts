import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/rules/**', 'src/units.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
});
