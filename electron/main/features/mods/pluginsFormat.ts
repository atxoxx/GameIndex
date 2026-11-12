/**
 * `plugins.txt` format decision, shared by the scanner and the writer.
 *
 * Legacy Bethesda titles (Morrowind … Fallout NV) use presence-means-enabled;
 * SSE/FO4/Starfield use a `*` prefix. The folder name is the only signal the
 * file itself carries, which is what the Rust implementation used too.
 */
import path from "node:path";

export function scanPluginsTxtStarFormat(pluginsTxt: string): boolean {
  const folder = path.basename(path.dirname(pluginsTxt));
  const legacy = ["Skyrim", "Oblivion", "Fallout3", "FalloutNV", "Morrowind"];
  return !legacy.some((name) => name.toLowerCase() === folder.toLowerCase());
}
