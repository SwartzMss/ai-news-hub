import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'prototype/**'] },
  {
    files: ['apps/server/**/*.ts', 'apps/admin/**/*.ts', 'apps/admin/**/*.tsx', 'apps/web/**/*.ts', 'apps/web/**/*.tsx', 'packages/**/*.ts', 'scripts/**/*.ts', 'tools/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  // Existing protocol JSON is untyped; cleanup failure deliberately overrides a Turn result.
  { files: ['tools/codex-probe/client.ts'], rules: {
    '@typescript-eslint/no-explicit-any': 'off', 'no-unsafe-finally': 'off',
  } },
);
