/**
 * Format-preserving launch-options editing for Steam's `localconfig.vdf`.
 * Kept free of Electron/database imports so the VDF logic is testable.
 */

/** Quote a value for Steam's shell-like launch-options parser. */
export function quoteLaunchEnvValue(value: string): string {
  if (/^[A-Za-z0-9_/.,:;+@%=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Recover an AppID from a legacy game id or a `steam://` path. */
export function deriveSteamAppId(gameId: string, gamePath: string): number | null {
  const idMatch = /^steam[-:](\d+)$/i.exec(gameId.trim());
  if (idMatch) {
    const id = Number.parseInt(idMatch[1], 10);
    if (Number.isFinite(id) && id > 0) return id;
  }
  const pathMatch = /^steam:\/\/(?:run|launch|rungameid)\/(\d+)/i.exec(gamePath.trim());
  if (pathMatch) {
    const id = Number.parseInt(pathMatch[1], 10);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

interface Block {
  contentStart: number;
  contentEnd: number;
  blockEnd: number;
}

function findBlock(text: string, key: string, from: number): Block | null {
  const haystack = text.slice(from);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`"${escaped}"\\s*\\{`, "g");
  const match = matcher.exec(haystack);
  if (!match) return null;
  const open = from + match.index + match[0].lastIndexOf("{");
  const contentStart = open + 1;

  let depth = 1;
  let inString = false;
  for (let i = contentStart; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { contentStart, contentEnd: i, blockEnd: i + 1 };
      }
    }
  }
  return null;
}

function decodeVdfString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function encodeVdfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function appsBlock(text: string): Block | null {
  const root = findBlock(text, "UserLocalConfigStore", 0) ?? {
    contentStart: 0,
    contentEnd: text.length,
    blockEnd: text.length,
  };
  const software = findBlock(text, "Software", root.contentStart);
  if (!software) return null;
  const valve = findBlock(text, "Valve", software.contentStart);
  if (!valve) return null;
  const steam = findBlock(text, "Steam", valve.contentStart);
  if (!steam) return null;
  return findBlock(text, "apps", steam.contentStart);
}

/** Read the app's current `LaunchOptions` string, or "". */
export function readSteamLaunchOptions(text: string, appId: number | string): string {
  const apps = appsBlock(text);
  if (!apps) return "";
  const app = findBlock(text, String(appId), apps.contentStart);
  if (!app) return "";
  const block = text.slice(app.contentStart, app.contentEnd);
  const match = /"LaunchOptions"\s*"((?:[^"\\]|\\.)*)"/.exec(block);
  return match ? decodeVdfString(match[1]) : "";
}

/** Return the file text with this app's LaunchOptions replaced/inserted. */
export function setSteamLaunchOptions(
  text: string,
  appId: number | string,
  value: string,
): string | null {
  const encoded = encodeVdfString(value);
  const apps = appsBlock(text);
  if (!apps) return null;

  const id = String(appId);
  const app = findBlock(text, id, apps.contentStart);
  if (app) {
    const block = text.slice(app.contentStart, app.contentEnd);
    const match = /("LaunchOptions"\s*)"((?:[^"\\]|\\.)*)"/.exec(block);
    if (match) {
      if (decodeVdfString(match[2]) === value) return null;
      const start = app.contentStart + match.index + match[1].length;
      return `${text.slice(0, start)}"${encoded}"${text.slice(start + match[2].length + 2)}`;
    }
    const insert = `\n\t\t\t\t\t"LaunchOptions"\t\t"${encoded}"\n\t\t\t\t`;
    return `${text.slice(0, app.contentEnd)}${insert}${text.slice(app.contentEnd)}`;
  }

  const entry = `\n\t\t\t\t"${id}"\n\t\t\t\t{\n\t\t\t\t\t"LaunchOptions"\t\t"${encoded}"\n\t\t\t\t}\n\t\t\t`;
  return `${text.slice(0, apps.contentEnd)}${entry}${text.slice(apps.contentEnd)}`;
}

/**
 * Replace our managed prefix while preserving the user's own post-`%command%`
 * arguments. `previous` is the prefix recorded on the previous launch.
 */
export function mergeSteamLaunchOptions(
  existing: string,
  previous: string,
  prefix: string,
): string {
  let rest = existing.trim();
  if (previous && rest.startsWith(previous)) {
    rest = rest.slice(previous.length).trimStart();
  }
  const marker = rest.indexOf("%command%");
  const args = marker >= 0 ? rest.slice(marker + "%command%".length).trim() : rest;
  const managed = prefix.trim();
  if (!managed) return args;
  return `${managed} %command%${args ? ` ${args}` : ""}`;
}
