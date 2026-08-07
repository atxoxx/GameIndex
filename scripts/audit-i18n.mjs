#!/usr/bin/env node
/**
 * i18n audit script.
 *
 * Checks the 6 locale dictionaries (en/de/es/fr/ru/zh-CN) for parity:
 *   1. Every key present in en.ts (source of truth) must exist in every
 *      other locale file -> MISSING (error, exit code 1).
 *   2. No locale may define keys that en.ts does not have -> SURPLUS (warn).
 *   3. Every static `t("a.b.c")` / `t('a.b.c')` call in src/** (ts/tsx)
 *      must resolve to a key defined in en.ts -> UNRESOLVED (error).
 *   4. Placeholders used in en.ts values ({var}) should also appear in the
 *      translated value of the same key -> PLACEHOLDER (warn).
 *
 * Locale files are plain TS modules exporting a flat object of
 * `"dotted.key": "value",` entries. The file format is:
 *
 *   import type { TranslationDict } from "./index";
 *
 *   export const en: TranslationDict = {
 *     "a.b.c": "...",
 *     ...
 *   };
 *
 * The parser is tolerant: it accepts both single and double quoted keys and
 * both `export const <name>` and `export default` export styles.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const I18N_DIR = join(ROOT, "src", "i18n");
const SRC_DIR = join(ROOT, "src");

const LOCALES = ["en", "de", "es", "fr", "ru", "zh-CN"];
const LOCALE_FILES = {
  en: "en.ts",
  de: "de.ts",
  es: "es.ts",
  fr: "fr.ts",
  ru: "ru.ts",
  "zh-CN": "zh-CN.ts",
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Extract { key: value } entries from a locale TS file.
 * Tolerates single/double quoted keys, any indentation and `export const
 * <name>: X = {` / `export default {` wrappers.
 */
function parseLocaleKeys(filePath) {
  const text = readFileSync(filePath, "utf8");

  // Locate the dictionary object literal. Locale files use
  // `export const en: TranslationDict = { ... };` (or `export default {`).
  // Find the `=` followed by `{` at statement level, then balance braces
  // while ignoring string contents so nested braces in values are skipped.
  const objStart = text.search(/=\s*\{|export\s+default\s*\{/);
  if (objStart === -1) {
    throw new Error(`${filePath}: no object literal found`);
  }
  const openIdx = text.indexOf("{", objStart);
  if (openIdx === -1) {
    throw new Error(`${filePath}: no object literal found`);
  }

  let depth = 0;
  let closeIdx = -1;
  let inString = null;
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    throw new Error(`${filePath}: unbalanced braces in object literal`);
  }

  const body = text.slice(openIdx + 1, closeIdx);

  // Match `"key": "value",` entries (single or double quoted keys and
  // values, including multi-line values). We walk line-by-line so each
  // entry is captured atomically regardless of embedded quotes.
  const entries = new Map();
  let pos = 0;
  while (pos < body.length) {
    const lineEnd = body.indexOf("\n", pos);
    const line = lineEnd === -1 ? body.slice(pos) : body.slice(pos, lineEnd);
    const keyRe = /^\s*(?:\/\/[^\r\n]*)?\s*(["'])([a-zA-Z0-9_.]+)\1\s*:\s*(["'])/;
    const m = keyRe.exec(line);
    if (m) {
      const quote = m[3];
      // Find the closing quote of the value (respecting escapes), possibly
      // spanning multiple lines.
      let v = pos + m[0].length;
      let value = "";
      let closed = false;
      let esc = false;
      for (; v < body.length; v++) {
        const ch = body[v];
        if (esc) {
          esc = false;
          value += ch;
        } else if (ch === "\\") {
          esc = true;
          value += ch;
        } else if (ch === quote) {
          closed = true;
          break;
        } else {
          value += ch;
        }
      }
      if (closed) {
        entries.set(m[2], value);
        pos = v + 1; // past closing quote
        continue;
      }
      // Unterminated value: bail out of this entry and continue scanning.
      pos = lineEnd === -1 ? body.length : lineEnd + 1;
      continue;
    }
    pos = lineEnd === -1 ? body.length : lineEnd + 1;
  }

  if (entries.size === 0) {
    throw new Error(`${filePath}: no keys extracted (unexpected format?)`);
  }
  return entries;
}

/** Extract placeholder names {foo} from a value string. */
function placeholders(value) {
  const out = new Set();
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m;
  while ((m = re.exec(value)) !== null) out.add(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

/** Recursively collect all .ts/.tsx files under dir. */
function collectSourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const T_CALL_RE =
  /\bt\(\s*(["'])([a-zA-Z0-9_.]+)\1\s*\)/g;

/** Find static t("...") calls across all source files. */
function scanSourceKeys() {
  const used = new Map(); // key -> [files]
  for (const file of collectSourceFiles(SRC_DIR)) {
    const text = readFileSync(file, "utf8");
    let m;
    while ((m = T_CALL_RE.exec(text)) !== null) {
      const key = m[2];
      if (!used.has(key)) used.set(key, []);
      const list = used.get(key);
      const rel = file.slice(ROOT.length + 1);
      if (!list.includes(rel)) list.push(rel);
    }
  }
  return used;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const errors = [];
const warnings = [];

const enPath = join(I18N_DIR, LOCALE_FILES.en);
const en = parseLocaleKeys(enPath);

// --- 1. + 2. Locale parity ------------------------------------------------
for (const locale of LOCALES.slice(1)) {
  const file = join(I18N_DIR, LOCALE_FILES[locale]);
  const keys = parseLocaleKeys(file);

  const missing = [...en.keys()].filter((k) => !keys.has(k));
  const surplus = [...keys.keys()].filter((k) => !en.has(k));

  for (const k of missing) {
    errors.push(`[${locale}] MISSING key: ${k} (present in en.ts)`);
  }
  for (const k of surplus) {
    warnings.push(`[${locale}] SURPLUS key: ${k} (not present in en.ts)`);
  }

  // --- 4. Placeholder parity (warn only) ----------------------------------
  // Compare {vars} used in en.ts values against the translation.
  for (const k of en.keys()) {
    if (!keys.has(k)) continue;
    const enPh = placeholders(en.get(k));
    const locPh = placeholders(keys.get(k));
    for (const ph of enPh) {
      if (!locPh.has(ph)) {
        warnings.push(
          `[${locale}] PLACEHOLDER missing in "${k}": {${ph}} (en has it, translation does not)`,
        );
      }
    }
  }
}

// --- 3. Source usage scan --------------------------------------------------
const used = scanSourceKeys();
for (const [key, files] of used) {
  if (!en.has(key)) {
    errors.push(`UNRESOLVED t() key: ${key} (used in ${files.join(", ")} but missing from en.ts)`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const report = [];
report.push("=== i18n audit ===");
report.push(`Locales checked: ${LOCALES.join(", ")}`);
report.push(`en.ts (source of truth): ${en.size} keys`);
for (const locale of LOCALES.slice(1)) {
  const keys = parseLocaleKeys(join(I18N_DIR, LOCALE_FILES[locale]));
  report.push(`  ${locale}: ${keys.size} keys`);
}
report.push("");
report.push(`Source scan: ${used.size} unique t() keys referenced in src/`);
report.push("");
report.push(`Errors:   ${errors.length}`);
report.push(`Warnings: ${warnings.length}`);
report.push("");

if (warnings.length) {
  report.push("--- Warnings ---");
  report.push(...warnings);
  report.push("");
}
if (errors.length) {
  report.push("--- Errors ---");
  report.push(...errors);
  report.push("");
}

report.push(errors.length === 0 ? "RESULT: PASS" : "RESULT: FAIL");
console.log(report.join("\n"));

process.exit(errors.length === 0 ? 0 : 1);
