// ESLint (flat config). The page's sources (web/src/*.js and shared/sim.js) are classic scripts concatenated into one
// function body by tools/build-page.mjs, so they share top-level names across files: `no-undef` is off for them and
// tools/check.mjs parses them together instead. Server, tools and tests are ES modules on Node.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'public/', 'assets/', '.cache/'] },
  js.configs.recommended,
  {
    files: ['web/src/**/*.js', 'shared/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, PIXI: 'readonly' } },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-redeclare': 'off',
    },
  },
  {
    files: ['server/**/*.mjs', 'tools/**/*.mjs', 'test/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
