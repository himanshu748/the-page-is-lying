import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const networkModules = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process', 'worker_threads', 'cluster'];

export default tseslint.config(
  { ignores: ['node_modules/**', 'static/ui/dist/**', 'dist/judge-demo/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.forge/**', 'demo/payments-api/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The pure core must not touch Forge or the network (PLAN.md section 3.1).
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@forge/*'], message: 'src/core must stay pure: no @forge/* imports.' },
            { group: ['**/resolvers/**', '**/actions/**', '**/consumers/**', '**/storage/**', '**/repo/**', '**/service/**'], message: 'src/core must not depend on outer layers.' },
            // A regex, not a group: the group form also matches a relative './http' (the claim extractor's own http.ts).
            { regex: `^(node:)?(${networkModules.join('|')})$`, message: 'src/core must not use network or process modules.' },
          ],
        },
      ],
    },
  },
);
