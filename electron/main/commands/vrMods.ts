/**
 * VR mods commands.
 *
 * The catalog itself is a committed JSON snapshot imported directly by the
 * renderer, so opening the subtab is instant and works offline. Only the two
 * optional network lookups live here: repository facts (cached for hours) and
 * a project README (lazily fetched when its tab is opened).
 */
import { registerCommands, type CommandArgs, type CommandHandler } from "../ipc";
import { fetchVrReadme, fetchVrRepoMeta } from "../features/vrMods/enrich";

function text(args: CommandArgs, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

export const vrModCommands: Record<string, CommandHandler> = {
  get_vr_mod_repo: (args) => fetchVrRepoMeta(text(args, "url")),

  get_vr_mod_readme: (args) => {
    const url = text(args, "url");
    if (!url) throw new Error("get_vr_mod_readme requires a url");
    return fetchVrReadme(url);
  },
};

export function registerVrModCommands(): void {
  registerCommands(vrModCommands);
}
