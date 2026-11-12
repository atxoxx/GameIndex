/**
 * Plugin runtime public surface.
 *
 * The sources workstream can import `searchWithPlugins` (or `getPluginRuntime`)
 * from here without knowing how sandboxes or storage work:
 *
 * ```ts
 * import { searchWithPlugins } from "../features/plugins";
 * const hits = await searchWithPlugins(gameName, pluginSources, { aliases, releaseYear });
 * ```
 *
 * `sources` is a list of plugin ids or `{ pluginId, name?, platformCategory? }`
 * descriptors (as returned by the Sources UI). An empty list means "every
 * enabled plugin".
 */
export {
  PluginRuntime,
  MIN_MATCH_SCORE,
  mergeDuplicates,
  toDownloadResult,
} from "./runtime";
export type { InstallPluginArgs, PluginRuntimeOptions } from "./runtime";

export {
  declaredConfigKeys,
  normalizePlatformCategory,
  PLUGIN_ID_RE,
} from "./manifest";
export type { PluginConfigField, PluginManifest } from "./manifest";

export {
  emptyPluginDocument,
  normalizePluginDocument,
  PLUGIN_CONFIG_FILE,
  PLUGIN_MANIFEST_FILE,
  PLUGIN_SOURCE_FILE,
  PluginRegistry,
  sha256Hex,
} from "./registry";
export type {
  PluginDocumentStore,
  PluginRegistryOptions,
  SecretCipher,
} from "./registry";

export { DEFAULT_MEMORY_LIMIT_BYTES, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_REQUESTS } from "./sandbox";
export type { HttpTextFn, SandboxLimits, SandboxNetworkPolicy } from "./sandbox";

export { getPluginRuntime, searchWithPlugins } from "./host";

export type * from "./types";
