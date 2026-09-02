// Flat config (ESLint 9+) replacing .eslintrc.json - see README/commit for
// why: the old .eslintrc setup pulled in eslint@8, itself deprecated along
// with its @humanwhocodes/* internals.
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  js.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  // Pinned to 6.1.1 rather than the current 7.x latest: 7.x folds React
  // Compiler's much stricter purity/refs/set-state-in-effect etc. rules
  // into "recommended" itself, which flags a lot of normal, working
  // pre-compiler code (Date.now() in useState initializers, refs read
  // during a render-time calculation, Math.random() in a useMemo
  // initializer) - a real linting-policy change, not something to pull in
  // as a side effect of an unrelated deprecated-package cleanup.
  ...reactHooks.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
