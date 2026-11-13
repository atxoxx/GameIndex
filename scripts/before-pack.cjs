/**
 * electron-builder `beforePack` hook.
 *
 * Some dependencies compile a single native addon for the *build host*:
 * `node-datachannel` (WebRTC for WebTorrent) is the important one. Packaging a
 * Linux AppImage from a Windows checkout therefore puts a PE binary in a Linux
 * archive - the build succeeds, and the app breaks at runtime when the torrent
 * engine loads WebRTC.
 *
 * Every other shipped addon (better-sqlite3, utp-native,
 * fs-native-extensions) bundles prebuilds for all platforms, so they need no
 * check.
 *
 * Set `GI_ALLOW_CROSS_PACK=1` to produce a package anyway (for inspection);
 * it will not run on the target OS.
 */
const fs = require("node:fs");
const path = require("node:path");

/** Addons that carry exactly one binary, compiled for the current host. */
const HOST_ONLY_ADDONS = [
  "node_modules/node-datachannel/build/Release/node_datachannel.node",
];

function kindOf(head) {
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return "win32"; // MZ
  if (head.length >= 4 && head[0] === 0x7f && head.subarray(1, 4).toString() === "ELF") {
    return "linux";
  }
  if (head.length >= 4) {
    const magic = head.readUInt32BE(0);
    if (magic === 0xcffaedfe || magic === 0xfeedfacf || magic === 0xcafebabe) return "darwin";
  }
  return "unknown";
}

function readHead(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(8);
    const read = fs.readSync(fd, buffer, 0, 8, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

exports.default = async function beforePack(context) {
  const target = context.electronPlatformName;
  if (process.env.GI_ALLOW_CROSS_PACK === "1") return;

  const root = context.packager.projectDir;
  const wrong = [];
  for (const relative of HOST_ONLY_ADDONS) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const kind = kindOf(readHead(file));
    if (kind !== target) wrong.push(`${relative} is a ${kind} binary, target is ${target}`);
  }
  if (wrong.length === 0) return;

  throw new Error(
    `[before-pack] This checkout's native addons do not match the ${target} package:\n` +
      wrong.map((line) => `  - ${line}`).join("\n") +
      `\nBuild ${target} artifacts on ${target === "linux" ? "Linux" : target} ` +
      "(or in CI): run `npm ci` there so the addons are built for that host, then " +
      "`npm run dist`. Set GI_ALLOW_CROSS_PACK=1 only to inspect a package that " +
      "will not run on the target.",
  );
};
