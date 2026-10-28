import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/node_modules', '**/out', '**/dist', '**/coverage']),
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Allowed only with an eslint-disable comment explaining why.
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    files: [
      '*.{js,mjs,ts}',
      'apps/desktop/*.ts',
      'apps/desktop/e2e/**/*.ts',
      'apps/desktop/src/{main,preload}/**/*.ts'
    ],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite]
  },
  {
    // prompt-lang must stay pure: no Node, Electron, React, or ambient clock/randomness.
    files: ['packages/prompt-lang/src/**/*.ts'],
    ignores: ['**/*.test.ts', 'packages/prompt-lang/src/test-utils.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'prompt-lang must not use Node APIs.' },
            {
              group: ['electron', 'react', 'react-dom'],
              message: 'prompt-lang must stay framework-free.'
            }
          ],
          paths: ['fs', 'path', 'os', 'url', 'crypto', 'process', 'buffer'].map((name) => ({
            name,
            message: 'prompt-lang must not use Node APIs.'
          }))
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use RenderContext.now; prompt-lang must be deterministic.'
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Use RenderContext.now; prompt-lang must be deterministic.'
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'prompt-lang must be deterministic.'
        }
      ]
    }
  },
  prettier
)
