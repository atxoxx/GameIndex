#!/usr/bin/env node
/**
 * Node 26's `extract-zip` never settles, so electron's own postinstall exits 0
 * after writing only the first locale. `npm ci` then succeeds while
 * `node_modules/electron/dist` has no binary, and electron-builder fails much
 * later with "Electron failed to install correctly".
 *
 * This root postinstall checks for the binary and, when it is missing,
 * downloads/reuses @electron/get's zip and extracts it with adm-zip's
 * synchronous extractor. On Node 20/24 (where electron's installer works) it
 * is a no-op.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronDir = join(root, "node_modules", "electron");

if (!existsSync(electronDir)) process.exit(0);
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(0);
if (process.env.ELECTRON_OVERRIDE_DIST_PATH) process.exit(0);

const electronPackage = createRequire(join(electronDir, "package.json"));
const { version } = electronPackage("./package.json");
const platformPath =
  process.platform === "win32"
    ? "electron.exe"
    : process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron"
      : "electron";

const distDir = join(electronDir, "dist");
const binary = join(distDir, platformPath);
const pathFile = join(electronDir, "path.txt");

if (existsSync(binary)) {
  if (!existsSync(pathFile) || readFileSync(pathFile, "utf8") !== platformPath) {
    writeFileSync(pathFile, platformPath);
  }
  process.exit(0);
}

console.log(`ensure-electron: ${process.platform}-${process.arch} binary missing, restoring`);
const { downloadArtifact } = electronPackage("@electron/get");
const zipPath = await downloadArtifact({
  version,
  artifactName: "electron",
  platform: process.platform,
  arch: process.arch,
});

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
new AdmZip(zipPath).extractAllTo(distDir, true, true);

const typeDef = join(distDir, "electron.d.ts");
if (existsSync(typeDef)) {
  renameSync(typeDef, join(electronDir, "electron.d.ts"));
}
if (process.platform !== "win32") {
  chmodSync(binary, 0o755);
}
writeFileSync(pathFile, platformPath);
console.log(`ensure-electron: restored ${binary}`);
