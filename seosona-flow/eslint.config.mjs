// P2.T7 — ESLint flat config. Establishes a green baseline over a large legacy
// classic-script codebase: syntax-level safety as errors, style debt as
// warnings. Quantitative debt is ratcheted separately by check-budgets.mjs.
import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/**',
      'lib/**', // vendored libraries
      'artifacts/**',
      'assets/**',
      'icons/**',
      'tests/fixtures/**', // intentionally malformed negative fixtures
      '**/*.min.js',
      'src/core/gwr-bundle.js', // vendored/generated bundle
      'src/core/watermark-alpha-data.js', // generated data blob
      // Thư mục THAM KHẢO (prototype Vue + docs để học pattern), KHÔNG phải mã extension.
      // Nó dùng ES module nên bị parse lỗi dưới cấu hình classic-script của repo →
      // trước đây làm `npm run lint` luôn đỏ, che mất lint thật của mã extension.
      'magnific-ai-review/**',
      // File nháp ở gốc repo (untracked, thử regex, chuỗi chưa đóng) — không phải mã sản phẩm.
      // Nên xoá; loại khỏi lint để nó không che lint thật.
    ],
  },

  // My tooling and tests: modern ESM, stricter.
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs', 'playwright.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off', // Node/Web globals used without declaration
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
    },
  },

  // Extension runtime: classic scripts with implicit browser/chrome globals.
  {
    files: ['**/*.js'],
    ignores: ['scripts/**', 'tests/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
    },
    rules: {
      // Syntax-level defects that are almost always real bugs -> error.
      'no-dupe-args': 'error',
      // Legacy product code has a known duplicate method (GenTab._escapeHtml);
      // fixing runtime is deferred to Phase 4. Track as warn, not a blocker.
      'no-dupe-class-members': 'warn',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-obj-calls': 'error',
      'no-unsafe-negation': 'error',
      'use-isnan': 'error',
      'no-debugger': 'error',
      // Legacy debt tolerated at baseline (tracked by check-budgets) -> off/warn.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-cond-assign': 'off',
      'no-constant-condition': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-prototype-builtins': 'off',
      'no-redeclare': 'off',
      'no-fallthrough': 'off',
      'no-misleading-character-class': 'off',
      'no-async-promise-executor': 'off',
      'no-inner-declarations': 'off',
      'no-sparse-arrays': 'off',
      'no-irregular-whitespace': 'off',
      'no-self-assign': 'off',
      'no-unsafe-finally': 'off',
      'no-dupe-keys': 'warn',
      'no-unreachable': 'warn',
      'getter-return': 'off',
      'no-setter-return': 'off',
      'no-extra-boolean-cast': 'off',
    },
  },
];
