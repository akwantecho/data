import baseConfig from '@sip/config/eslint.base.js';
import globals from 'globals';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // NestJS relies on parameter decorators and empty constructors for DI.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['constructors'] }],
    },
  },
];
