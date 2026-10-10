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
  // The battle sim runs in Node (the server's prediction) and in every browser (the replays): it must give the same bits
  // everywhere, so only exactly rounded arithmetic. Engines differ in the last bits of Math.sin / cos / atan2 / hypot / pow
  // / exp / log … (V8's hypot is up to 2 ulp off; SpiderMonkey and JavaScriptCore compute it another way); `**` is pow.
  // Math.sqrt, abs, floor, round, min, max, imul and + − × ÷ are exact. No Math.random either: a battle draws from its
  // seed (W.rng).
  {
    files: ['shared/sim.js'],
    rules: {
      'no-restricted-properties': ['error', ...['hypot', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
        'pow', 'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'cbrt', 'random'].map((property) => ({ object: 'Math', property, message: 'not bit-identical across engines (or not seeded): the sim must replay the same everywhere' }))],
      'no-restricted-syntax': ['error', { selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']", message: '** is Math.pow: not bit-identical across engines' }],
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
