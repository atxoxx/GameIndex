/**
 * Ports catalogue commands (unofficial PC ports tab).
 *
 * `get_ports_catalog` answers from the merged cache instantly and
 * `refresh_ports_catalog` performs the slow multi-source sync, so the renderer
 * can paint the last catalog while refreshing in the background. Sync progress
 * is exposed for the page's "syncing" indicator.
 */
import { registerCommands, type CommandArgs, type CommandHandler } from "../ipc";
import { getPortCover, getPortCovers } from "../features/ports/covers";
import { fetchPortReadme, fetchPortRepoMeta } from "../features/ports/readme";
import {
  getPortsCatalog,
  getPortsSyncProgress,
  refreshPortsCatalog,
} from "../features/ports/sync";

function text(args: CommandArgs, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function flag(args: CommandArgs, key: string): boolean {
  return args[key] === true;
}

export const portCommands: Record<string, CommandHandler> = {
  get_ports_catalog: () => getPortsCatalog(),

  refresh_ports_catalog: (args) => refreshPortsCatalog(flag(args, "force")),

  get_ports_sync_status: () => getPortsSyncProgress(),

  get_port_cover: (args) => {
    const name = text(args, "name");
    if (!name) throw new Error("get_port_cover requires a name");
    return getPortCover(name, flag(args, "refresh"));
  },

  get_port_covers: (args) => {
    const names = Array.isArray(args.names)
      ? args.names.map((value) => String(value)).filter(Boolean)
      : [];
    return getPortCovers(names);
  },

  get_port_readme: (args) => {
    const url = text(args, "url");
    if (!url) throw new Error("get_port_readme requires a url");
    return fetchPortReadme(url);
  },

  get_port_repo: (args) => fetchPortRepoMeta(text(args, "url")),
};

export function registerPortCommands(): void {
  registerCommands(portCommands);
}
