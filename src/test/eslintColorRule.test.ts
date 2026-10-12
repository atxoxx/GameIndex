import { describe, it, expect } from "vitest";
import { Linter } from "eslint";
import css from "@eslint/css";
// @ts-expect-error -- local ESLint plugin is plain JS without type declarations
import { cssColors, jsColors } from "../../eslint-rules/index.js";

const cssLinter = new Linter();
const jsLinter = new Linter();

const cssConfig = [
  {
    files: ["**/*.css"],
    language: "css/css",
    plugins: { css, "gameindex-css": cssColors },
    rules: { "gameindex-css/no-hardcoded-colors": "error" },
  },
];

const jsConfig = [
  {
    files: ["**/*.ts"],
    plugins: { gameindex: jsColors },
    rules: { "gameindex/no-hardcoded-colors": "error" },
  },
];

function lintCss(code: string) {
  return cssLinter.verify(code, cssConfig as never, { filename: "test.css" });
}

function lintJs(code: string) {
  return jsLinter.verify(code, jsConfig as never, { filename: "test.ts" });
}

describe("no-hardcoded-colors (CSS)", () => {
  it("reports hex colours in normal declarations", () => {
    const messages = lintCss("a { color: #ff0000; background: #fff; }");
    expect(messages).toHaveLength(2);
    expect(messages[0].message).toContain("#ff0000");
  });

  it("allows a hex value that defines a design token", () => {
    expect(lintCss(":root { --color-accent: #635bff; }")).toHaveLength(0);
  });

  it("allows token registration inside @property", () => {
    const code = '@property --x { syntax: "<color>"; initial-value: #fff; }';
    expect(lintCss(code)).toHaveLength(0);
  });

  it("allows neutral black/white scrims and shadows", () => {
    const code = "a { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5); color: rgba(255 255 255 / 80%); }";
    expect(lintCss(code)).toHaveLength(0);
  });

  it("reports coloured rgb()/hsl() values", () => {
    expect(lintCss("a { background: rgba(99, 91, 255, 0.3); }")).toHaveLength(1);
    expect(lintCss("a { color: hsl(280, 80%, 60%); }")).toHaveLength(1);
  });

  it("allows a var() fallback (the token is the primary value)", () => {
    expect(lintCss("a { color: var(--color-accent-contrast, #fff); }")).toHaveLength(0);
  });
});

describe("no-hardcoded-colors (JS/TS)", () => {
  it("reports hex strings in inline styles", () => {
    const messages = lintJs('const s = { color: "#f59e0b" };');
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("#f59e0b");
  });

  it("allows object properties that define a custom-property token", () => {
    expect(lintJs('const s = { "--color-accent": "#635bff" };')).toHaveLength(0);
  });

  it("allows neutral rgba strings but not coloured ones", () => {
    expect(lintJs('const s = { color: "rgba(0, 0, 0, 0.4)" };')).toHaveLength(0);
    expect(lintJs('const s = { color: "rgba(99, 91, 255, 0.3)" };')).toHaveLength(1);
  });

  it("ignores pointer-fragment-looking strings", () => {
    expect(lintJs('const href = "#section-2";')).toHaveLength(0);
  });

  it("ignores dynamic rgb() template strings built from runtime values", () => {
    expect(lintJs("const c = `rgb(${r}, ${g}, ${b})`;")).toHaveLength(0);
    expect(lintJs('const c = "rgb(" + r + ")"')).toHaveLength(0);
  });

  it("still reports a literal rgb() string", () => {
    expect(lintJs('const c = "rgb(255, 0, 0)";')).toHaveLength(1);
  });

  it("reports a hex literal inside a static template", () => {
    expect(lintJs("const c = `1px solid #ff0000`;")).toHaveLength(1);
  });
});
