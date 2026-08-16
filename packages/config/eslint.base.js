// Shared ESLint flat-config building blocks.
// Apps extend this with their own environment/framework specific rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/** Directories that are never linted. */
export const ignores = {
  ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**', '**/*.d.ts'],
};

/** Base rule set shared by every TypeScript package in the monorepo. */
export const baseConfig = [
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
];

export default baseConfig;
