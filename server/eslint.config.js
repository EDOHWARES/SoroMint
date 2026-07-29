const node = require('eslint-plugin-node');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        node: 'readonly',
        jest: 'readonly',
      },
    },
    plugins: {
      node,
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'node/no-unsupported-features/es-syntax': 'off',
      'node/no-process-exit': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    rules: {
      'node/no-unpublished-require': 'off',
    },
  },
  prettier,
];