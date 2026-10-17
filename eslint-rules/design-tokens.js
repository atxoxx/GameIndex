/**
 * `no-hardcoded-length` — keeps geometry on the design system.
 *
 * A length is "hardcoded" when it is an absolute `px` / `rem` literal written
 * instead of a scale token (`--text-*`, `--radius-*`, `--space-*`). Literals in
 * `var()` / `calc()` / `clamp()` / `min()` / `max()` are runtime expressions and
 * therefore legitimate, as are keywords, percentages, `em` and relative units.
 *
 * Deliberately tolerated (not rhythm):
 *   - `border-radius` below the scale floor (< 4px), e.g. 1–2px micro radii;
 *   - negative spacing, used for optical alignment nudges (`margin: -2px`).
 *
 * Token tables are the single source of truth in `styles/theme.css`; a literal
 * elsewhere silently breaks the "shape is theme-invariant" contract.
 */

const FUNCTIONS = new Set(["var", "calc", "clamp", "min", "max", "env", "color-mix", "rgb", "rgba", "hsl", "hsla"]);

/** Remove `fn(...)` spans so their inner literals are not inspected. */
function stripFunctions(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (/[a-z]/i.test(text[i])) {
      let j = i;
      while (j < text.length && /[\w-]/.test(text[j])) j++;
      if (text[j] === "(" && FUNCTIONS.has(text.slice(i, j).toLowerCase())) {
        let depth = 0;
        for (; j < text.length; j++) {
          if (text[j] === "(") depth++;
          else if (text[j] === ")") { depth--; if (depth === 0) { j++; break; } }
        }
        i = j;
        continue;
      }
    }
    out += text[i++];
  }
  return out;
}

const SPACING_PROP = /^(?:row-gap|column-gap|gap|padding|margin)(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$/;
const LENGTH = /(-?\d*\.?\d+)(px|rem)\b/gi;

/** Return the first offending literal in `value` for the given property, or null. */
export function findHardcodedLength(property, value) {
  const prop = String(property).toLowerCase();
  const isFont = prop === "font-size";
  const isRadius = prop === "border-radius";
  const isSpacing = SPACING_PROP.test(prop);
  if (!isFont && !isRadius && !isSpacing) return null;

  const bare = stripFunctions(value);
  LENGTH.lastIndex = 0;
  let m;
  while ((m = LENGTH.exec(bare))) {
    const unit = m[2].toLowerCase();
    const px = unit === "px" ? parseFloat(m[1]) : parseFloat(m[1]) * 16;
    if (isFont) return m[0];
    if (isRadius) { if (Math.abs(px) >= 4) return m[0]; continue; }
    if (px >= 0) return m[0];
  }
  return null;
}

const messages = {
  unexpected:
    "Unexpected hardcoded length '{{value}}'. Use a design token (var(--text-*), var(--radius-*) or var(--space-*)).",
};
const docs = {
  description: "Disallow hardcoded px/rem lengths in type, radius and spacing outside token references",
  recommended: false,
};

const cssRule = {
  meta: { type: "problem", languages: ["css/css"], docs, schema: [], messages },
  create(context) {
    return {
      Declaration(node) {
        const property = node.property;
        if (typeof property !== "string" || property.startsWith("--")) return;
        const text = context.sourceCode.getText(node);
        const colon = text.indexOf(":");
        const value = colon >= 0 ? text.slice(colon + 1) : text;
        const bad = findHardcodedLength(property, value);
        if (bad) context.report({ node, messageId: "unexpected", data: { value: bad } });
      },
    };
  },
};

const STYLE_PROPS = new Set([
  "fontSize", "borderRadius",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "gap", "rowGap", "columnGap",
]);

function keyName(key) {
  if (!key) return "";
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  return "";
}

const jsRule = {
  meta: { type: "problem", languages: ["js"], docs, schema: [], messages },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        const parent = node.parent;
        if (!parent || parent.type !== "Property" || parent.value !== node) return;
        const name = keyName(parent.key);
        if (!STYLE_PROPS.has(name)) return;
        const bad = findHardcodedLength(name, node.value);
        if (bad) context.report({ node, messageId: "unexpected", data: { value: bad } });
      },
    };
  },
};

export const cssLengths = {
  meta: { name: "@gameindex/css-lengths", version: "1.0.0" },
  rules: { "no-hardcoded-length": cssRule },
};

export const jsLengths = {
  meta: { name: "@gameindex/js-lengths", version: "1.0.0" },
  rules: { "no-hardcoded-length": jsRule },
};
