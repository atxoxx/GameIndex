/**
 * Local ESLint rules that ban hardcoded colour literals.
 *
 * Two plugins are exported because CSS and JS/TS use different languages and
 * therefore register their rule under a different namespace:
 *
 *   - `@gameindex/css` → `no-hardcoded-colors` (language `css/css`)
 *   - `@gameindex/js`  → `no-hardcoded-colors` (language `js`)
 *
 * Colours are allowed only where a design token is *being defined* — i.e. as
 * the value of a custom-property declaration (`--color-accent: #635bff`) or a
 * JS/TS object property keyed by a `--token` name. Everywhere else the code
 * must reference `var(--…)` so every theme keeps working.
 */

import {
  COLOR_FUNCTIONS,
  findColorLiteral,
  findHexLiteral,
  isCustomPropertyKey,
  isHexValue,
  isNeutralColorFunction,
} from "./color-literals.js";

const messages = {
  unexpected:
    "Unexpected hardcoded color '{{value}}'. Use a design token (var(--…)) or define it once as a custom property.",
};

const docs = {
  description: "Disallow hardcoded color literals outside token definitions",
  recommended: false,
};

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function walkValue(valueNode, visit) {
  if (!valueNode || !Array.isArray(valueNode.children)) return;
  for (const child of valueNode.children) {
    visit(child);
    walkValue(child, visit);
  }
}

const cssRule = {
  meta: {
    type: "problem",
    languages: ["css/css"],
    docs,
    schema: [],
    messages,
  },
  create(context) {
    // `@property --x { initial-value: #fff }` registers a token, so its
    // descriptor declarations are token definitions too.
    let propertyAtRuleDepth = 0;
    return {
      "Atrule[name=/^property$/i]"() {
        propertyAtRuleDepth += 1;
      },
      "Atrule[name=/^property$/i]:exit"() {
        propertyAtRuleDepth -= 1;
      },
      Declaration(node) {
        if (propertyAtRuleDepth > 0) return;
        // A custom-property declaration *is* the token table — literals there
        // are the single source of truth and are exempt.
        if (typeof node.property === "string" && node.property.startsWith("--")) {
          return;
        }
        walkValue(node.value, (child) => {
          if (child.type === "Hash" && isHexValue(child.value)) {
            context.report({
              node: child,
              messageId: "unexpected",
              data: { value: `#${child.value}` },
            });
          } else if (
            child.type === "Function" &&
            COLOR_FUNCTIONS.has(String(child.name).toLowerCase()) &&
            !isNeutralColorFunction(child)
          ) {
            context.report({
              node: child,
              messageId: "unexpected",
              data: { value: `${child.name}()` },
            });
          }
        });
      },
    };
  },
};

// ---------------------------------------------------------------------------
// JS / TS
// ---------------------------------------------------------------------------

const jsRule = {
  meta: {
    type: "problem",
    languages: ["js"],
    docs,
    schema: [],
    messages,
  },
  create(context) {
    function check(node, text, allowFunctions = true) {
      const parent = node.parent;
      if (parent && parent.type === "Property") {
        // `{ "--token": "#fff" }` — the key names the token, and its value is
        // the definition. Both are legitimate.
        if (parent.value === node && isCustomPropertyKey(parent.key)) return;
        if (parent.key === node && isCustomPropertyKey(node)) return;
      }
      const literal = allowFunctions
        ? findColorLiteral(text)
        : findHexLiteral(text);
      if (literal) {
        context.report({
          node,
          messageId: "unexpected",
          data: { value: literal },
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        // `rgb(${r}, ${g}, ${b})` interpolates runtime values, so only a
        // static template (no expressions) can contain a literal colour.
        const template = node.parent;
        const dynamic =
          template?.type === "TemplateLiteral" &&
          template.expressions.length > 0;
        check(node, node.value.raw, !dynamic);
      },
    };
  },
};

export const cssColors = {
  meta: { name: "@gameindex/css", version: "1.0.0" },
  rules: { "no-hardcoded-colors": cssRule },
};

export const jsColors = {
  meta: { name: "@gameindex/js", version: "1.0.0" },
  rules: { "no-hardcoded-colors": jsRule },
};
