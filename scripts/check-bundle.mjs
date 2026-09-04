#!/usr/bin/env node
/**
 * Bundle-size gate for CI. Fails the build when the emitted JS regresses
 * past the budgets below. Run after `npm run build` (needs dist/assets).
 *
 * Budgets are in raw bytes and deliberately carry headroom over today's
 * bundle (entry ~835 KB, locales up to ~444 KB) so the gate catches
 * regressions rather than normal churn. Tighten them toward the stretch
 * targets (entry ≤ 450 KB) as the P1/P2 bundle work lands.
 */
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "dist", "assets");

const BUDGETS = {
  entry: 950_000, // index-*.js — cold-boot critical path
  locale: 520_000, // de/fr/es/ru/zh-CN dictionaries
  total: 9_500_000, // all JS combined (< 10 MB bundle target)
};

const LOCALE_PREFIXES = ["de-", "fr-", "es-", "ru-", "zh-CN-"];

let entries;
try {
  entries = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
} catch {
  console.error("check-bundle: dist/assets not found — run `npm run build` first.");
  process.exit(1);
}

const sizeOf = (f) => statSync(join(assetsDir, f)).size;

const entryFiles = entries.filter((f) => f.startsWith("index-"));
const entryMax = Math.max(0, ...entryFiles.map(sizeOf));

const localeFiles = entries.filter((f) => LOCALE_PREFIXES.some((p) => f.startsWith(p)));
const localeMax = Math.max(0, ...localeFiles.map(sizeOf));

const total = entries.reduce((sum, f) => sum + sizeOf(f), 0);

const failures = [];
if (entryMax > BUDGETS.entry) {
  failures.push(`entry chunk ${entryMax.toLocaleString()} B exceeds ${BUDGETS.entry.toLocaleString()} B (${entryFiles.join(", ")})`);
}
if (localeMax > BUDGETS.locale) {
  failures.push(`largest locale chunk ${localeMax.toLocaleString()} B exceeds ${BUDGETS.locale.toLocaleString()} B`);
}
if (total > BUDGETS.total) {
  failures.push(`total JS ${total.toLocaleString()} B exceeds ${BUDGETS.total.toLocaleString()} B`);
}

console.log(
  `check-bundle: entry ${entryMax.toLocaleString()} B, largest locale ${localeMax.toLocaleString()} B, total ${total.toLocaleString()} B`,
);

if (failures.length > 0) {
  console.error("check-bundle FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("check-bundle OK");
