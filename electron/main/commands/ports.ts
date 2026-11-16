/**
 * Ports catalogue commands (unofficial PC ports tab).
 *
 * Thin argument normalization over `features/ports/**`; failures surface to
 * the renderer as readable messages because the tab owns its error state.
 */
import { registerCommands, type CommandArgs, type CommandHandler } from "../ipc";
import { fetchPortsCatalog } from "../features/ports/catalog";
import { getPortCover, getPortCovers } from "../features/ports/covers";
import { fetchPortReadme, fetchPortRepoMeta } from "../features/ports/readme";

function text(args: CommandArgs, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function flag(args: CommandArgs, key: string): boolean {
  return args[key] === true;
}

export const portCommands: Record<string, CommandHandler> = {
  get_ports_catalog: (args) => fetchPortsCatalog(flag(args, "refresh")),

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
