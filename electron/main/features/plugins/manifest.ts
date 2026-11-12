/**
 * Manifest parsing, validation and normalisation.
 *
 * Mirrors `PluginManifest` / `PluginConfigField` and the validation rules in
 * `plugins_import_file` (`src-tauri/src/plugins/mod.rs`): the id must match
 * `^[a-z0-9-]+$`, name/version are required, and the platform category is
 * normalised to one of `pc | console | hybrid`.
 */

export interface PluginConfigField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  description?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  sourceUrl: string;
  platformCategory: string;
  allowedHosts: string[];
  rateLimitMs: number;
  cacheTtlSecs?: number;
  icon?: string;
  homepage?: string;
  capabilities: string[];
  config: PluginConfigField[];
  /** Manifest keys this build does not know about are preserved verbatim. */
  [key: string]: unknown;
}

export const PLUGIN_ID_RE = /^[a-z0-9-]+$/;

/** Hard cap on an imported plugin file (the Rust build had no explicit cap). */
export const MAX_PLUGIN_SOURCE_BYTES = 2 * 1024 * 1024;

/** Normalise a declared platform class to the three canonical values. */
export function normalizePlatformCategory(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "console") return "console";
  if (value === "hybrid" || value === "both") return "hybrid";
  return "pc";
}

/**
 * Reject ids that cannot be a directory name. Besides the documented charset,
 * this blocks path traversal (`../x`), drive separators and reserved Windows
 * device names — the id becomes `userData/plugins/<id>/`.
 */
export function assertValidPluginId(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("Plugin id must be a string");
  }
  const id = raw.trim();
  if (!id) throw new Error("Plugin id is required");
  if (!PLUGIN_ID_RE.test(id)) {
    throw new Error(`Plugin id "${id}" must match ^[a-z0-9-]+$`);
  }
  if (id.startsWith("-") || id.endsWith("-")) {
    throw new Error(`Plugin id "${id}" must not start or end with "-"`);
  }
  // Windows reserved device names would alias a device, not a folder.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) {
    throw new Error(`Plugin id "${id}" is a reserved Windows device name`);
  }
  return id;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeConfigField(raw: unknown): PluginConfigField | null {
  if (raw === null || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const key = asString(input.key).trim();
  if (!key) return null;
  const field: PluginConfigField = {
    key,
    label: asString(input.label).trim() || key,
  };
  if (input.secret === true) field.secret = true;
  if (input.required === true) field.required = true;
  const placeholder = asString(input.placeholder);
  if (placeholder) field.placeholder = placeholder;
  const description = asString(input.description);
  if (description) field.description = description;
  return field;
}

/**
 * Turn the object a plugin passed to `definePlugin` (already dumped to plain
 * JSON by the sandbox) into a validated manifest. Unknown keys are copied so a
 * newer manifest does not lose data before the next app version reads it.
 */
export function normalizeManifest(raw: unknown): PluginManifest {
  if (raw === null || typeof raw !== "object") {
    throw new Error("definePlugin must be called with a descriptor object");
  }
  const input = raw as Record<string, unknown>;
  const id = assertValidPluginId(input.id);
  const name = asString(input.name).trim();
  if (!name) throw new Error("Plugin name is required");
  const version = asString(input.version).trim();
  if (!version) throw new Error("Plugin version is required");

  const manifest: PluginManifest = {
    ...input,
    id,
    name,
    version,
    author: asString(input.author).trim(),
    description: asString(input.description).trim(),
    sourceUrl: asString(input.sourceUrl).trim(),
    platformCategory: normalizePlatformCategory(input.platformCategory),
    allowedHosts: asStringArray(input.allowedHosts),
    rateLimitMs: Math.max(0, Math.floor(asNumber(input.rateLimitMs) ?? 0)),
    capabilities: asStringArray(input.capabilities),
    config: Array.isArray(input.config)
      ? input.config
          .map(normalizeConfigField)
          .filter((field): field is PluginConfigField => field !== null)
      : [],
  };

  const ttl = asNumber(input.cacheTtlSecs);
  if (ttl !== undefined && ttl >= 0) {
    manifest.cacheTtlSecs = Math.floor(ttl);
  }
  // `search` is a live function inside the sandbox and never part of the
  // stored manifest; `config` has already been reduced to the safe subset.
  delete manifest.search;
  return manifest;
}

/** Declared config keys, in manifest order, de-duplicated. */
export function declaredConfigKeys(manifest: PluginManifest | null | undefined): string[] {
  const fields = Array.isArray(manifest?.config) ? manifest.config : [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const field of fields) {
    const key = typeof field?.key === "string" ? field.key.trim() : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** Strip everything the sandbox owns so a manifest is safe to persist. */
export function toStoredManifest(manifest: PluginManifest): PluginManifest {
  const clone = JSON.parse(JSON.stringify(manifest)) as PluginManifest;
  delete clone.search;
  return clone;
}
