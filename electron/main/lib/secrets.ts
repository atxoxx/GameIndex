/**
 * Build-time secrets (API keys) and runtime overrides.
 *
 * The Tauri build baked five keys into the Rust binary at compile time via
 * `build.rs` + `env!`. The Electron build keeps that model: `electron.vite`
 * replaces `__GI_BAKED_ENV__` with a JSON object built from the same environment
 * variables (so CI secrets still work), and a local `.env` file is read as a
 * developer fallback.
 *
 * Order of precedence: `process.env` (dev / CI) → `.env` → baked value.
 * Packaged builds have no `.env`, so the baked values are what ship.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

declare const __GI_BAKED_ENV__: Record<string, string> | undefined;

/** The keys the old `build.rs` required. Extend as more integrations land. */
export const BAKED_ENV_KEYS = [
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "OPENCRITIC_RAPIDAPI_KEY",
  "DISCORD_CLIENT_ID",
  "STEAMGRIDDB_API_KEY",
] as const;

export type SecretName =
  | (typeof BAKED_ENV_KEYS)[number]
  | "IGDB_CLIENT_ID"
  | "IGDB_CLIENT_SECRET"
  | "STEAM_API_KEY"
  | "NEXUS_API_KEY"
  | "REAL_DEBRID_KEY"
  | "ALL_DEBRID_KEY"
  | "PREMIUMIZE_KEY"
  | "TORBOX_KEY";

let dotenv: Map<string, string> | null = null;

function loadDotEnv(): Map<string, string> {
  if (dotenv) return dotenv;
  dotenv = new Map();
  const candidates = [
    path.join(app.getAppPath(), ".env"),
    path.join(process.cwd(), ".env"),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        dotenv.set(key, value);
      }
      break;
    } catch {
      /* try next candidate */
    }
  }
  return dotenv;
}

/** Read a secret, or null when it was not configured for this build. */
export function getSecret(name: SecretName | string): string | null {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const fromFile = loadDotEnv().get(name);
  if (fromFile && fromFile.trim()) return fromFile.trim();

  const baked =
    typeof __GI_BAKED_ENV__ !== "undefined" ? __GI_BAKED_ENV__?.[name] : undefined;
  if (baked && baked.trim()) return baked.trim();

  return null;
}

export function hasSecret(name: SecretName | string): boolean {
  return getSecret(name) !== null;
}

/**
 * Throwing variant for commands that cannot degrade gracefully. The message is
 * surfaced in the UI, so it names the missing variable instead of the feature.
 */
export function requireSecret(name: SecretName | string): string {
  const value = getSecret(name);
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env before building, or set it in the environment.`,
    );
  }
  return value;
}
