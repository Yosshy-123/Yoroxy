/*
 * ESLint flat config (ESLint 9+).
 *
 *   npm run lint
 *
 * Three kinds of source live in this repo, each with different globals:
 *   - public/assets/js/**  classic browser <script>s (not modules), no bundler
 *   - index.js, src/**, scripts/**
 *                          Node ES modules (the Express server, maintenance scripts)
 *   - test/**              Node ES modules that also embed browser code inside
 *                          page.evaluate(), hence both sets of globals
 * public/uv/** is vendored Ultraviolet and is not linted.
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'public/uv/**', 'test/reports/**'],
  },
  js.configs.recommended,
  {
    rules: {
      // Unused `catch (err)` bindings are intentional throughout (best-effort
      // cross-origin / storage access); unused variables and arguments are not,
      // except arguments prefixed with `_` (e.g. Express's 4-argument error
      // handler signature, which needs `_next` to be recognised as one).
      'no-unused-vars': ['error', { caughtErrors: 'none', args: 'after-used', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['public/assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['index.js', 'src/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
