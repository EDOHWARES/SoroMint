const js = require("@eslint/js");
const prettier = require("eslint-config-prettier");
const nodePlugin = require("eslint-plugin-n");
const globals = require("globals");
const unusedImports = require("eslint-plugin-unused-imports");

module.exports = [
  js.configs.recommended,
  nodePlugin.configs["flat/recommended"],
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          "vars": "all",
          "varsIgnorePattern": "^_",
          "args": "after-used",
          "argsIgnorePattern": "^_(.*)?$|req|res|next|err|error"
        }
      ],
      "no-console": "off",
      "n/no-unsupported-features/es-syntax": "off",
      "n/no-process-exit": "off"
    }
  },
  {
    files: ["tests/**/*.js"],
    rules: {
      "n/no-unpublished-require": "off"
    }
  },
  prettier
];
