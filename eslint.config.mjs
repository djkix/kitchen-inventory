// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint du monorepo. Règles volontairement centrées sur les erreurs réelles et
 * les consignes du projet (`any` interdit hors tests), pas sur le style, que
 * Prettier n'impose pas ici.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'apps/web/dev-dist/**', 'tools/**', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'warn',
    },
  },
  {
    // NestJS s'appuie sur emitDecoratorMetadata : une classe importée pour être
    // injectée doit rester un import de valeur, sinon la DI perd le type à l'exécution.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.e2e-spec.ts', '**/test/**/*.ts', 'prisma/seed/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },
);
