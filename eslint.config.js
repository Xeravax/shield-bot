import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  Buffer: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  structuredClone: "readonly",
  NodeJS: "readonly",
};

const typescriptRules = {
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "no-unused-vars": "off",
  "no-undef": "off",
  "@typescript-eslint/explicit-function-return-type": "off",
  "@typescript-eslint/no-non-null-assertion": "warn",
  "no-console": "off",
  "prefer-const": "warn",
  "no-var": "error",
  eqeqeq: ["warn", "always"],
  curly: ["warn", "all"],
  "no-throw-literal": "warn",
  "prefer-promise-reject-errors": "warn",
  "no-useless-catch": "error",
  "no-empty": "error",
};

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: nodeGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: typescriptRules,
  },
  {
    files: ["dashboard/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./dashboard/tsconfig.eslint.json",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: nodeGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: typescriptRules,
  },
  {
    ignores: [
      "build/**",
      "node_modules/**",
      "src/generated/**",
      "dashboard/dist/**",
      "dashboard/node_modules/**",
      "*.config.js",
    ],
  },
];
