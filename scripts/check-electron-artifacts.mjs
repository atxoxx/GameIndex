#!/usr/bin/env node
/**
 * Verifies the installer names emitted by electron-builder.
 *
 * The release workflow uploads every `release/*` file, so a changed
 * `artifactName` template must fail loudly instead of silently shipping the
 * old default names. Run after `npm run dist:linux` or `npm run dist:win`.
 *
 * An optional target (`linux` or `win32`) lets a cross-build verify the
 * artifacts it just produced instead of the host platform's defaults.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = join(root, "release");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const requested = process.argv[2];
const target =
  requested === "win" || requested === "windows"
    ? "win32"
    : requested || process.platform;

const expected = [];
if (target === "linux") {
  expected.push(`GameIndex_electron_${version}_amd64.AppImage`);
  expected.push(`GameIndex_electron_${version}_amd64.deb`);
} else if (target === "win32") {
  expected.push(`GameIndex_electron_${version}_x64-setup.exe`);
  expected.push(`GameIndex_electron_${version}_x64_portable.exe`);
} else {
  console.log(`check-electron-artifacts: no packaged target for ${target}`);
  process.exit(0);
}

const missing = expected.filter((name) => !existsSync(join(release, name)));
if (missing.length === 0) {
  console.log(`check-electron-artifacts OK: ${expected.join(", ")}`);
  process.exit(0);
}

console.error("check-electron-artifacts FAILED; missing:");
for (const name of missing) console.error(`  - ${name}`);

const present = existsSync(release)
  ? readdirSync(release).filter((name) => /\.(AppImage|deb|exe)$/i.test(name))
  : [];
if (present.length > 0) {
  console.error(`present: ${present.join(", ")}`);
}
process.exit(1);
