import { dirname } from 'path'
import { fileURLToPath } from 'url'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import eslintPluginImport from 'eslint-plugin-import-x'
import prettierConfig from './.prettierrc.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'tests/**', 'eslint.config.mjs']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.json']
      }
    },
    plugins: {
      prettier: eslintPluginPrettier,
      import: eslintPluginImport
    },
    rules: {
      'prettier/prettier': ['error', prettierConfig],
      'no-use-before-define': 'off',
      'no-debugger': 'warn',
      'default-param-last': 'off',
      'sort-imports': ['error', { ignoreCase: true, ignoreDeclarationSort: true }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          disallowTypeAnnotations: false
        }
      ],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal'],
          pathGroups: [
            {
              pattern: 'preact',
              group: 'external',
              position: 'before'
            },
            {
              pattern: 'preact/**',
              group: 'external',
              position: 'before'
            }
          ],
          pathGroupsExcludedImportTypes: ['preact'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true
          }
        }
      ]
    },
    linterOptions: {
      reportUnusedDisableDirectives: true
    }
  }
)
