#!/usr/bin/env node
/**
 * Tauri version gate for CI. `tauri build` aborts before it compiles anything
 * when the `tauri` Rust crate and the `@tauri-apps/api` npm package do not
 * share a major/minor release:
 *
 *   Found version mismatched Tauri packages. Make sure the NPM package and
 *   Rust crate versions are on the same major/minor releases:
 *   tauri (v2.12.2) : @tauri-apps/api (v2.11.1)
 *
 * The release workflow only discovers that after a tag is pushed, and it fails
 * both platforms at once. Comparing the two lockfiles here turns a silent
 * `cargo update` into a red PR instead.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `[[package]]` blocks in Cargo.lock, parsed without a TOML dependency. */
function readCargoCrateVersion(crate) {
  const lock = readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8");
  for (const block of lock.split("[[package]]")) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1];
    if (name !== crate) continue;
    const version = block.match(/^version = "([^"]+)"/m)?.[1];
    if (version) return version;
  }
  return null;
}

/** The version `npm ci` will actually install. */
function readNpmPackageVersion(name) {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  return lock.packages?.[`node_modules/${name}`]?.version ?? null;
}

const minor = (version) => version.split(".").slice(0, 2).join(".");

const crateVersion = readCargoCrateVersion("tauri");
const npmVersion = readNpmPackageVersion("@tauri-apps/api");

if (!crateVersion || !npmVersion) {
  console.error(
    `check-tauri-versions: could not resolve versions (tauri crate: ${crateVersion}, @tauri-apps/api: ${npmVersion})`,
  );
  process.exit(1);
}

console.log(`check-tauri-versions: tauri ${crateVersion}, @tauri-apps/api ${npmVersion}`);

if (minor(crateVersion) !== minor(npmVersion)) {
  console.error(
    `check-tauri-versions FAILED: the tauri crate (${crateVersion}) and @tauri-apps/api ` +
      `(${npmVersion}) must share a major/minor release or \`tauri build\` will abort. ` +
      `Bump @tauri-apps/api to ${minor(crateVersion)}.`,
  );
  process.exit(1);
}
console.log("check-tauri-versions OK");
