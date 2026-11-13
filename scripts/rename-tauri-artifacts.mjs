#!/usr/bin/env node
/**
 * Adds the `_tauri_` variant token to Tauri's bundle output names.
 *
 * Tauri has no artifact-name template, so `tauri build` always emits names
 * such as `GameIndex_2.4.0_amd64.AppImage` and
 * `GameIndex_2.4.0_x64-setup.exe`. The Tauri and Electron branches ship from
 * separate releases, so this script renames the local bundles before CI
 * uploads them:
 *
 *   GameIndex_tauri_<version>_amd64.AppImage
 *   GameIndex_tauri_<version>_amd64.deb
 *   GameIndex_tauri_<version>_x64-setup.exe
 *   GameIndex_tauri_<version>_x64_portable.exe
 *
 * `.sig` files are renamed alongside their artifact so the updater manifest
 * keeps working. The Windows portable exe is a copy of the raw release
 * binary, matching the previous release workflow.
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tauri = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);

if (pkg.version !== tauri.version) {
  console.error(
    `rename-tauri-artifacts: package.json is ${pkg.version} but ` +
      `src-tauri/tauri.conf.json is ${tauri.version}; Tauri names bundles ` +
      "with the config version, so the release tag would not match.",
  );
  process.exit(1);
}

const version = tauri.version;
const bundle = join(root, "src-tauri", "target", "release", "bundle");
const release = join(root, "src-tauri", "target", "release");

const renamed = [];
const missing = [];

/**
 * Replace `to` with the freshly built `from` (and its .sig). If `from` is
 * already gone but `to` exists, a previous run already renamed this build.
 */
function renameArtifact(from, to) {
  if (!existsSync(from)) {
    if (!existsSync(to)) missing.push(from);
    return;
  }
  rmSync(to, { force: true });
  rmSync(`${to}.sig`, { force: true });
  renameSync(from, to);
  if (existsSync(`${from}.sig`)) {
    renameSync(`${from}.sig`, `${to}.sig`);
  }
  renamed.push(to);
}

function copyPortable() {
  const from = join(release, "GameIndex.exe");
  const to = join(release, `GameIndex_tauri_${version}_x64_portable.exe`);
  if (!existsSync(from)) {
    if (!existsSync(to)) missing.push(from);
    return;
  }
  // A signature from a previous build cannot cover the new binary.
  rmSync(`${to}.sig`, { force: true });
  copyFileSync(from, to);
  renamed.push(to);
}

if (process.platform === "linux") {
  renameArtifact(
    join(bundle, "appimage", `GameIndex_${version}_amd64.AppImage`),
    join(bundle, "appimage", `GameIndex_tauri_${version}_amd64.AppImage`),
  );
  renameArtifact(
    join(bundle, "deb", `GameIndex_${version}_amd64.deb`),
    join(bundle, "deb", `GameIndex_tauri_${version}_amd64.deb`),
  );
} else if (process.platform === "win32") {
  renameArtifact(
    join(bundle, "nsis", `GameIndex_${version}_x64-setup.exe`),
    join(bundle, "nsis", `GameIndex_tauri_${version}_x64-setup.exe`),
  );
  copyPortable();
} else {
  console.log(`rename-tauri-artifacts: no Tauri bundle naming for ${process.platform}`);
  process.exit(0);
}

for (const name of renamed) console.log(`rename-tauri-artifacts: ${name}`);

if (missing.length > 0) {
  console.error("rename-tauri-artifacts FAILED; expected build output missing:");
  for (const name of missing) console.error(`  - ${name}`);
  if (existsSync(bundle)) {
    for (const directory of readdirSync(bundle)) {
      const files = readdirSync(join(bundle, directory)).filter(
        (name) => !name.endsWith(".sig"),
      );
      if (files.length > 0) console.error(`  ${directory}: ${files.join(", ")}`);
    }
  }
  process.exit(1);
}

console.log(`rename-tauri-artifacts OK (${renamed.length} artifacts)`);
