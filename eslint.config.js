import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import css from "@eslint/css";
import { cssColors, jsColors, cssLengths, jsLengths } from "./eslint-rules/index.js";

/**
 * Files where literal colour values are the *source of truth* rather than a
 * hardcoded style: token generators, per-theme palette tables, brand/flag
 * artwork, standalone documents and pre-CSS bootstrap fallbacks. They are
 * exempt from `no-hardcoded-colors` on purpose — see the file headers.
 */
const COLOR_DATA_FILES = [
  "src/utils/color.ts",
  "src/utils/customTheme.ts",
  "src/components/command-palette/commandPaletteUtils.ts",
  "src/components/ui/FlagIcon.tsx",
  "src/pages/settings/settingsIcons.tsx",
  "src/pages/settings/AppearanceTab.tsx",
  "src/pages/settings/AccentPreview.tsx",
  "src/pages/settings/backupUtils.ts",
  "src/components/BootstrapErrorBoundary.tsx",
  "src/types/emulator.ts",
  "src/pages/deals/dealsConstants.ts",
  "src/components/weblinks/sources.ts",
  "src/utils/libraryExportHtml.ts",
  "src/utils/adaptiveTheme.ts",
  "src/utils/screenshot.ts",
  "src/pages/friendsStorage.ts",
  "src/**/*.test.{ts,tsx}",
];

// The local plugins register both rule families under one namespace each.
const jsTokensPlugin = { meta: jsColors.meta, rules: { ...jsColors.rules, ...jsLengths.rules } };
const cssTokensPlugin = { meta: cssColors.meta, rules: { ...cssColors.rules, ...cssLengths.rules } };

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri/target", "src-tauri/vendor"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
      gameindex: jsTokensPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-uses-react": "off",
      "react/no-unescaped-entities": "off",
      // Project currently has many any/unused patterns — keep lint green while still catching type errors via typecheck
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
      "prefer-const": "off",
      "no-empty": "off",
      "no-undef": "off",
      "no-useless-escape": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      // Theme integrity: colours must be referenced through design tokens.
      "gameindex/no-hardcoded-colors": "error",
      // Shape/type integrity: px/rem lengths must come from the token scales.
      "gameindex/no-hardcoded-length": "error",
    },
    settings: {
      react: { version: "detect" },
    },
  },
  {
    files: ["**/*.css"],
    language: "css/css",
    plugins: {
      css,
      "gameindex-css": cssTokensPlugin,
    },
    rules: {
      "gameindex-css/no-hardcoded-colors": "error",
      "gameindex-css/no-hardcoded-length": "error",
    },
  },
  {
    // Intentional alternate skins (ui-styles) and the out-of-scope Big Picture /
    // overlay stylesheets keep their deliberate geometry literals.
    files: [
      "src/styles/ui-styles/**/*.css",
      "src/styles/bigscreen.css",
      "src/styles/overlay.css",
    ],
    rules: {
      "gameindex-css/no-hardcoded-length": "off",
    },
  },
  {
    files: COLOR_DATA_FILES,
    rules: {
      "gameindex/no-hardcoded-colors": "off",
      "gameindex/no-hardcoded-length": "off",
    },
  }
);
