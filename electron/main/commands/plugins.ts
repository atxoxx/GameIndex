/**
 * Plugin runtime commands (install/list/toggle/config/test search).
 *
 * Workstream: `plugins`. Reference: `git show HEAD:src-tauri/src/plugins/`
 * (`mod.rs` command layer, `runtime.rs` QuickJS sandbox).
 *
 * Implemented here:
 *   plugins_import_file, plugins_install, plugins_list, plugins_toggle,
 *   plugins_set_all_enabled, plugins_remove, plugins_set_config,
 *   plugins_clear_config, plugins_config_status, plugins_test_search,
 *   plugins_check_availability, save_plugin_availability_cache,
 *   load_plugin_availability_cache
 */
import { registerCommands, type CommandHandler } from "../ipc";
import { readDocumentText, writeDocumentText } from "../state/db/documents";
import {
  getPluginRuntime,
  type InstallPluginArgs,
  type PluginCandidate,
} from "../features/plugins";

/** Renderer-owned availability map, now a `kv.db` document. */
const AVAILABILITY_CACHE_DOCUMENT = "plugin_availability_cache";

function stringArg(args: Record<string, unknown>, key: string, label = key): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`Expected "${label}" to be a string`);
  }
  return value;
}

function idArg(args: Record<string, unknown>): string {
  const id = stringArg(args, "id").trim();
  if (!id) throw new Error("Expected a plugin id");
  return id;
}

export const pluginCommands: Record<string, CommandHandler> = {
  /** Read + validate a `.js` file. Nothing is persisted. */
  plugins_import_file: (args) =>
    getPluginRuntime().importFile(stringArg(args, "path", "path")),

  /** Persist the candidate the user confirmed (re-verifies hash + manifest). */
  plugins_install: (args) => {
    const candidate =
      args.candidate && typeof args.candidate === "object"
        ? (args.candidate as Partial<PluginCandidate>)
        : null;
    const inline: InstallPluginArgs = { candidate };
    if (typeof args.source === "string") inline.source = args.source;
    else if (typeof args.script === "string") inline.source = args.script;
    return getPluginRuntime().install(inline);
  },

  plugins_list: () => getPluginRuntime().list(),

  plugins_toggle: (args) => getPluginRuntime().toggle(idArg(args)),

  plugins_set_all_enabled: (args) => {
    if (typeof args.enabled !== "boolean") {
      throw new Error('Expected "enabled" to be a boolean');
    }
    return getPluginRuntime().setAllEnabled(args.enabled);
  },

  plugins_remove: (args) => {
    getPluginRuntime().remove(idArg(args));
    return null;
  },

  plugins_set_config: (args) => {
    if (typeof args.value !== "string") {
      throw new Error('Expected "value" to be a string');
    }
    getPluginRuntime().setConfig(
      idArg(args),
      stringArg(args, "key", "key"),
      args.value,
    );
    return null;
  },

  plugins_clear_config: (args) => {
    getPluginRuntime().clearConfig(idArg(args), stringArg(args, "key", "key"));
    return null;
  },

  plugins_config_status: (args) => getPluginRuntime().configStatus(idArg(args)),

  plugins_test_search: (args) => {
    const query = stringArg(args, "query", "query").trim();
    if (!query) throw new Error("Enter a search query to test");
    return getPluginRuntime().testSearch(idArg(args), query);
  },

  plugins_check_availability: (args) => {
    const query = stringArg(args, "query", "query").trim();
    if (!query) return [];
    const releaseYear =
      typeof args.releaseYear === "number" && Number.isFinite(args.releaseYear)
        ? args.releaseYear
        : null;
    const aliases = Array.isArray(args.aliases)
      ? args.aliases.filter((alias): alias is string => typeof alias === "string")
      : [];
    return getPluginRuntime().checkAvailability({ query, releaseYear, aliases });
  },

  /**
   * The renderer owns the per-(game, plugin) map and posts the serialized
   * document. Validate it before replacing the file so a broken write cannot
   * silence the Store filter on the next launch.
   */
  save_plugin_availability_cache: (args) => {
    const data = stringArg(args, "data", "data");
    if (data.trim() !== "") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new Error("save_plugin_availability_cache expects valid JSON");
      }
      if (parsed === null || typeof parsed !== "object") {
        throw new Error("save_plugin_availability_cache expects a JSON object");
      }
    }
    writeDocumentText("kv", AVAILABILITY_CACHE_DOCUMENT, data);
    return null;
  },

  /** Empty string on first run, matching the Rust command and the hook. */
  load_plugin_availability_cache: () =>
    readDocumentText("kv", AVAILABILITY_CACHE_DOCUMENT, ""),
};

export function registerPluginCommands(): void {
  registerCommands(pluginCommands, { override: true });
}
