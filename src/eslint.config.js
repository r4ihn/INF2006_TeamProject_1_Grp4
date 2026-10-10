// Shared ESLint config for the whole repo (flat config, ESLint 9+/10).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '.backups/**',
      'backend/src/generated/**',
      'forecasting/.venv/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Backend: Node.js
  {
    files: ['backend/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Plain browser scripts copied as-is into the build (e.g. the startup guard)
  {
    files: ['frontend/public/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },

  // Frontend: browser + React
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Repo scripts (e.g. scripts/py.mjs) run in Node
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Config files at any level run in Node
  {
    files: ['*.config.{js,ts}', '**/*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Allow `_unused` args/vars (e.g. Express error handlers need 4 params)
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Must be last: turns off rules that conflict with Prettier
  prettier,
);
