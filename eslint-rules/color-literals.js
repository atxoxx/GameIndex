/**
 * Shared detection helpers for the `no-hardcoded-colors` rules.
 *
 * A color is considered "hardcoded" when it is written as a literal instead of
 * being resolved through a design token (`var(--…)`). The theme engine defines
 * every palette colour once in `styles/theme.css` / `styles/themes.css`; any
 * literal elsewhere silently breaks non-default themes (see todo.md → "Fix
 * Activity Page UI Inconsistencies").
 */

/** Matches a `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` token. */
export const HEX_PATTERN = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-fA-F])/;

/** CSS color function names whose arguments are literal colour components. */
export const COLOR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla"]);

/** Whether a bare hash value (without the leading `#`) is a hex colour. */
export function isHexValue(value) {
  return /^(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

function channelNumbers(functionNode) {
  const out = [];
  for (const child of functionNode.children || []) {
    if (child.type === "Number" || child.type === "Dimension" || child.type === "Percentage") {
      out.push(parseFloat(String(child.value)));
    }
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Neutral black/white `rgb()`/`rgba()`/`hsl()`/`hsla()` values are
 * deliberately theme-invariant — a black drop-shadow or a white scrim pill is
 * correct in every theme, so turning them into tokens would add churn without
 * fixing any theme. Coloured translucent values, by contrast, should be
 * derived from a token (`color-mix(in srgb, var(--color-accent) 30%, transparent)`).
 */
export function isNeutralColorFunction(functionNode) {
  const name = String(functionNode.name).toLowerCase();
  const channels = channelNumbers(functionNode);
  if (channels.length < 3) return false;
  if (name.startsWith("hsl")) return channels[1] === 0;
  return channels.every((n) => n === 0) || channels.every((n) => n === 255);
}

/** Matches a complete `rgb()`/`hsl()` call whose arguments contain a digit. */
const FUNCTION_CALL_PATTERN = /\b(?:rgb|rgba|hsl|hsla)\(\s*[^()]*\d[^()]*\)/gi;

/**
 * Read the arguments of the `rgb()`/`hsl()`-style call starting at `index`
 * (which points at the function name) and decide whether it is neutral.
 */
function isNeutralFunctionCall(text, index) {
  const head = /^([a-z]+)\s*\(/i.exec(text.slice(index));
  if (!head) return false;
  const name = head[1].toLowerCase();
  const open = index + head[0].length - 1;
  let depth = 1;
  let end = open + 1;
  while (end < text.length && depth > 0) {
    if (text[end] === "(") depth += 1;
    else if (text[end] === ")") depth -= 1;
    end += 1;
  }
  const args = text
    .slice(open + 1, end - 1)
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map((part) => parseFloat(part));
  if (args.length < 3) return false;
  if (name.startsWith("hsl")) return args[1] === 0;
  return args.slice(0, 3).every((n) => n === 0) || args.slice(0, 3).every((n) => n === 255);
}

/** Return the first hardcoded hex literal inside `text`, or `null`. */
export function findHexLiteral(text) {
  return HEX_PATTERN.exec(text)?.[0] ?? null;
}

/**
 * Return the first *hardcoded* colour literal inside `text`, or `null`.
 * Only complete `rgb()`/`hsl()` calls with numeric arguments count — a
 * `${…}`-interpolated or concatenated function head is a runtime value, not a
 * literal. Neutral black/white scrims (`rgba(0, 0, 0, .5)`) are skipped.
 */
export function findColorLiteral(text) {
  const fnRe = new RegExp(FUNCTION_CALL_PATTERN.source, "gi");
  let fn = fnRe.exec(text);
  while (fn && isNeutralFunctionCall(text, fn.index)) fn = fnRe.exec(text);
  const hex = HEX_PATTERN.exec(text);
  if (hex && (!fn || hex.index <= fn.index)) return hex[0];
  if (fn) return `${fn[0].slice(0, -1)}()`;
  return null;
}

/** Whether a static object key names a CSS custom property (`--token`). */
export function isCustomPropertyKey(keyNode) {
  return (
    !!keyNode &&
    keyNode.type === "Literal" &&
    typeof keyNode.value === "string" &&
    keyNode.value.startsWith("--")
  );
}
