#!/usr/bin/env node
/**
 * Static linter for GameIndex search plugins (plugins/*.js).
 *
 * The sandboxed runtime (src-tauri/src/plugins/runtime.rs) only discovers a
 * plugin through its `definePlugin(descriptor)` call, and only runs it when
 * the descriptor declares a callable `search` function. A malformed plugin
 * therefore fails silently at runtime (it is simply skipped). This script
 * catches the common authoring mistakes *before* the plugin is imported:
 *
 *   1. `definePlugin` must be called exactly once.
 *   2. The descriptor must declare every required manifest field:
 *      id, name, version, author, description, sourceUrl, platformCategory.
 *   3. `id` must match `^[a-z0-9-]+$`.
 *   4. `platformCategory` must be one of "pc" | "console" | "hybrid".
 *   5. The descriptor must declare a `search` function.
 *
 * The checks are textual (no plugin code is executed). To avoid matching
 * `definePlugin` or field names that only appear inside comments / strings /
 * regex literals, the source is first masked: comment bodies and the
 * *contents* of string, template and regex literals are replaced with spaces
 * while preserving offsets. Brace matching then runs over the masked source,
 * so the descriptor object literal is located reliably.
 *
 * Usage: node scripts/lint-plugins.mjs [plugin.js | dir ...]
 *   (no arguments → every plugins/*.js in the repo root)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const PLUGINS_DIR = join(ROOT, "plugins");

const REQUIRED_FIELDS = [
  "id",
  "name",
  "version",
  "author",
  "description",
  "sourceUrl",
  "platformCategory",
];

const ID_RE = /^[a-z0-9-]+$/;
const PLATFORM_CATEGORIES = new Set(["pc", "console", "hybrid"]);

// ---------------------------------------------------------------------------
// Source masking
// ---------------------------------------------------------------------------

/**
 * Return a copy of `src` with comment bodies and the contents of string,
 * template and regex literals replaced by spaces. Offsets and newlines are
 * preserved so the result can be brace-matched against the original.
 */
function maskSource(src) {
  const n = src.length;
  const out = src.split("");

  const blank = (from, to) => {
    for (let k = Math.max(0, from); k < Math.min(to, n); k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };

  let i = 0;
  let lastChar = "";
  let lastWord = "";

  // A `/` begins a regex literal when the previous token cannot end an
  // expression (after an operator / opener / keyword), otherwise it is
  // division. This mirrors the standard lexer heuristic and covers every
  // regex placement used by the bundled plugins (`= /re/`, `.match(/re/)`,
  // `.replace(/re/g, …)`, `search(/re/)`, …).
  const regexAllowed = () => {
    if (lastChar === "") return true;
    if (/[)\]}]/.test(lastChar)) return false;
    if (/[A-Za-z0-9_$]/.test(lastChar)) {
      return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(
        lastWord
      );
    }
    return true;
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // Line comment.
    if (c === "/" && c2 === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }

    // Block comment.
    if (c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
      continue;
    }

    // String / template literal (contents blanked, quotes kept).
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      blank(i + 1, j - 1);
      lastChar = quote;
      lastWord = "";
      i = j;
      continue;
    }

    // Regex literal.
    if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const ch = src[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) {
          j++;
          closed = true;
          break;
        } else if (ch === "\n") {
          break; // Not actually a regex; leave it as division.
        }
        j++;
      }
      if (closed) {
        while (j < n && /[a-z]/i.test(src[j])) j++; // flags
        blank(i + 1, j);
        lastChar = "/";
        lastWord = "";
        i = j;
        continue;
      }
    }

    // Identifier / keyword.
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      lastWord = src.slice(i, j);
      lastChar = src[j - 1];
      i = j;
      continue;
    }

    // Number.
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      lastChar = src[j - 1];
      lastWord = "";
      i = j;
      continue;
    }

    if (!/\s/.test(c)) {
      lastChar = c;
      lastWord = "";
    }
    i++;
  }

  return out.join("");
}

/**
 * Given the masked source and the index of the descriptor's opening `{`,
 * return the index of the matching closing `}` (or -1).
 */
function matchBrace(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Collect the top-level property names of the descriptor object literal.
 * Only keys at brace-depth 1 (direct children) are recorded, so `id:` inside
 * a nested result object or the `search` body is ignored.
 *
 * Returns a Map of key -> start index (in the masked source).
 */
function topLevelKeys(masked, openIdx) {
  const keys = new Map();
  let depth = 0;
  let i = openIdx;

  while (i < masked.length) {
    const c = masked[i];

    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0) break;
      i++;
      continue;
    }

    if (depth === 1 && /[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < masked.length && /[A-Za-z0-9_$]/.test(masked[j])) j++;
      const word = masked.slice(i, j);
      // Skip whitespace to find the token after the candidate key.
      let k = j;
      while (k < masked.length && /\s/.test(masked[k])) k++;
      const next = masked[k];
      // `key:` (and not `::`) or shorthand method `key(`.
      if (next === ":" && masked[k + 1] !== ":") {
        if (!keys.has(word)) keys.set(word, i);
      } else if (next === "(") {
        if (!keys.has(word)) keys.set(word, i);
      }
      i = j;
      continue;
    }

    i++;
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Per-file lint
// ---------------------------------------------------------------------------

function lintPlugin(path) {
  const errors = [];
  const src = readFileSync(path, "utf8");
  const masked = maskSource(src);

  const calls = masked.match(/\bdefinePlugin\s*\(/g) || [];
  if (calls.length === 0) {
    errors.push("does not call definePlugin");
    return errors;
  }
  if (calls.length > 1) {
    errors.push(`calls definePlugin ${calls.length} times (expected exactly once)`);
  }

  const callIdx = masked.search(/\bdefinePlugin\s*\(/);
  const openIdx = masked.indexOf("{", callIdx);
  if (openIdx === -1) {
    errors.push("definePlugin call has no descriptor object literal");
    return errors;
  }
  const closeIdx = matchBrace(masked, openIdx);
  if (closeIdx === -1) {
    errors.push("descriptor object literal is not balanced");
    return errors;
  }

  const keys = topLevelKeys(masked, openIdx);

  for (const field of REQUIRED_FIELDS) {
    if (!keys.has(field)) errors.push(`missing required manifest field: ${field}`);
  }

  // `id` shape.
  if (keys.has("id")) {
    const at = keys.get("id");
    const m = /^id\s*:\s*(["'])([^"']*)\1/.exec(src.slice(at));
    if (!m) {
      errors.push("`id` must be a string literal");
    } else if (!ID_RE.test(m[2])) {
      errors.push(`\`id\` "${m[2]}" must match ${ID_RE}`);
    }
  }

  // `platformCategory` value.
  if (keys.has("platformCategory")) {
    const at = keys.get("platformCategory");
    const m = /^platformCategory\s*:\s*(["'])([^"']*)\1/.exec(src.slice(at));
    if (!m) {
      errors.push("`platformCategory` must be a string literal");
    } else if (!PLATFORM_CATEGORIES.has(m[2])) {
      errors.push(
        `\`platformCategory\` "${m[2]}" must be one of pc | console | hybrid`
      );
    }
  }

  // `search` must be a function (declared method, `function`, or arrow).
  if (keys.has("search")) {
    const at = keys.get("search");
    const rest = src.slice(at);
    const isFunction =
      /^search\s*:\s*function\b/.test(rest) ||
      /^search\s*\(/.test(rest) ||
      /^search\s*:\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/.test(
        rest
      );
    if (!isFunction) errors.push("`search` must be a function");
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Target discovery
// ---------------------------------------------------------------------------

function collectTargets(args) {
  if (args.length === 0) {
    return readdirSync(PLUGINS_DIR)
      .filter((f) => f.endsWith(".js"))
      .sort()
      .map((f) => join(PLUGINS_DIR, f));
  }

  const out = [];
  for (const a of args) {
    const full = resolve(a);
    let st;
    try {
      st = statSync(full);
    } catch {
      console.error(`skip (not found): ${a}`);
      continue;
    }
    if (st.isDirectory()) {
      for (const f of readdirSync(full).filter((f) => f.endsWith(".js")).sort()) {
        out.push(join(full, f));
      }
    } else if (full.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const targets = collectTargets(process.argv.slice(2));

let failed = 0;
console.log("=== plugin lint ===");
console.log(`Scanning ${targets.length} file(s) under ${dirname(targets[0] || PLUGINS_DIR)}\n`);

for (const path of targets) {
  const label = basename(path);
  let errors;
  try {
    errors = lintPlugin(path);
  } catch (e) {
    errors = [`could not read: ${e.message}`];
  }
  if (errors.length === 0) {
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    for (const e of errors) console.log(`        - ${e}`);
  }
}

console.log("");
console.log(`Checked ${targets.length} plugin(s): ${targets.length - failed} passed, ${failed} failed`);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");

process.exit(failed === 0 ? 0 : 1);
