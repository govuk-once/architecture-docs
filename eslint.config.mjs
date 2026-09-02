/*
 * Standalone equivalent of the FLEX repository's shared config, carrying the rules this
 * code was written against — typescript-eslint's strictTypeChecked, sorted imports, sonarjs,
 * unicorn and prettier — so the source lints identically here.
 */
import js from "@eslint/js";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

const strictTypeChecked = tseslint.configs.strictTypeChecked.reduce(
  (acc, obj) => Object.assign(acc, obj.rules),
  {},
);

export default [
  {
    ignores: [
      "node_modules/**",
      "site/**",
      // Checkouts of the repositories this explorer documents. Not ours to lint.
      ".sources/**",
      /*
       * The explorer's browser assets are authored for the page, not for this toolchain.
       * app.js is written compactly because it is inlined verbatim into a single-file
       * document where bytes count, and it reads globals the build injects above it, so
       * both prettier and no-undef would be arguing with deliberate choices.
       */
      "explorer/app.js",
      "explorer/shell.html",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "simple-import-sort": simpleImportSort,
      sonarjs,
      unicorn,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...strictTypeChecked,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-floating-promises": ["error"],
      "@typescript-eslint/prefer-readonly": "warn",
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "sonarjs/no-nested-conditional": "warn",
      "sonarjs/redundant-type-aliases": "warn",
      "sonarjs/regex-complexity": "warn",
      "sonarjs/single-char-in-character-classes": "warn",
      "sonarjs/no-misleading-array-reverse": "warn",
      "sonarjs/no-nested-template-literals": "warn",
      "sonarjs/no-skipped-tests": "warn",
      "unicorn/no-useless-promise-resolve-reject": "warn",
      "unicorn/prefer-default-parameters": "warn",
      "unicorn/prefer-node-protocol": "warn",
      "unicorn/prefer-string-raw": "warn",
    },
  },
  {
    files: ["**/*.json"],
    language: "json/json",
    plugins: { json },
    rules: { "json/no-duplicate-keys": "error" },
  },
  {
    files: ["**/*.md"],
    language: "markdown/commonmark",
    plugins: { markdown },
    rules: { "markdown/no-html": "error" },
  },
  prettierRecommended,
];
