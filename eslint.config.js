import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules', 'out', 'data', 'web/dist', 'web/node_modules'] },
  js.configs.recommended,
  // Type-aware rules, which is the point: the value ESLint adds over tsc here is
  // catching mishandled promises. A dropped await in this pipeline swallows the
  // error and records nothing, which looks identical to a quiet day.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // allowDefaultProject covers files outside every tsconfig, such as this
        // config itself.
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // The pipeline reads third-party JSON, so casts at the boundary are the
      // design, not an oversight.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
)
