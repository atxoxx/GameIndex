import {
  contrastRatio,
  cssColorStringToHex,
  hexToRgb,
  luminance,
  textColorFor,
} from "./color";

/**
 * User-authored themes.
 *
 * A custom theme is defined by a small set of seed colors; every other
 * design token (borders, glows, hover/active states, surfaces, shadows)
 * is derived from those seeds. That keeps hand-authored themes coherent
 * and lets the editor stay small — users pick ~13 colors, not 50.
 */

export type CustomThemeMode = "dark" | "light";

export interface CustomThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accent2: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export type ThemeColorGroup = "surfaces" | "text" | "accent" | "status";

export interface ThemeColorField {
  key: keyof CustomThemeColors;
  group: ThemeColorGroup;
  labelKey: string;
}

export const THEME_COLOR_FIELDS: ThemeColorField[] = [
  { key: "bgPrimary", group: "surfaces", labelKey: "settings.themeCreator.field.bgPrimary" },
  { key: "bgSecondary", group: "surfaces", labelKey: "settings.themeCreator.field.bgSecondary" },
  { key: "bgTertiary", group: "surfaces", labelKey: "settings.themeCreator.field.bgTertiary" },
  { key: "bgHover", group: "surfaces", labelKey: "settings.themeCreator.field.bgHover" },
  { key: "textPrimary", group: "text", labelKey: "settings.themeCreator.field.textPrimary" },
  { key: "textSecondary", group: "text", labelKey: "settings.themeCreator.field.textSecondary" },
  { key: "textMuted", group: "text", labelKey: "settings.themeCreator.field.textMuted" },
  { key: "accent", group: "accent", labelKey: "settings.themeCreator.field.accent" },
  { key: "accent2", group: "accent", labelKey: "settings.themeCreator.field.accent2" },
  { key: "success", group: "status", labelKey: "settings.themeCreator.field.success" },
  { key: "warning", group: "status", labelKey: "settings.themeCreator.field.warning" },
  { key: "danger", group: "status", labelKey: "settings.themeCreator.field.danger" },
  { key: "info", group: "status", labelKey: "settings.themeCreator.field.info" },
];

export const THEME_COLOR_GROUPS: { key: ThemeColorGroup; titleKey: string }[] = [
  { key: "surfaces", titleKey: "settings.themeCreator.group.surfaces" },
  { key: "text", titleKey: "settings.themeCreator.group.text" },
  { key: "accent", titleKey: "settings.themeCreator.group.accent" },
  { key: "status", titleKey: "settings.themeCreator.group.status" },
];

/** Curated one-click swatches offered by every color field. Mixes neutrals
 *  (for surfaces/text) with the full spectrum (for accents/status). */
export const QUICK_COLOR_SWATCHES: string[] = [
  "#ffffff", "#cbd5e1", "#94a3b8", "#64748b", "#334155", "#0f172a", "#000000",
  "#f43f5e", "#ec4899", "#d946ef", "#a855f7", "#6366f1", "#3b82f6", "#0ea5e9",
  "#06b6d4", "#10b981", "#84cc16", "#eab308", "#f59e0b", "#f97316",
];

export const DEFAULT_DARK_COLORS: CustomThemeColors = {
  bgPrimary: "#08090c",
  bgSecondary: "#0e1017",
  bgTertiary: "#141722",
  bgHover: "#1b1f2e",
  textPrimary: "#f3f5fa",
  textSecondary: "#a3abc0",
  textMuted: "#747e98",
  accent: "#635bff",
  accent2: "#857eff",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#f43f5e",
  info: "#38bdf8",
};

export const DEFAULT_LIGHT_COLORS: CustomThemeColors = {
  bgPrimary: "#f2f5f9",
  bgSecondary: "#ffffff",
  bgTertiary: "#edf1f7",
  bgHover: "#e3e9f2",
  textPrimary: "#0f172a",
  textSecondary: "#334155",
  textMuted: "#78849a",
  accent: "#6d28d9",
  accent2: "#8b5cf6",
  success: "#047857",
  warning: "#b45309",
  danger: "#be123c",
  info: "#0369a1",
};

const SEED_VARS: Array<[keyof CustomThemeColors, string]> = [
  ["bgPrimary", "--color-bg-primary"],
  ["bgSecondary", "--color-bg-secondary"],
  ["bgTertiary", "--color-bg-tertiary"],
  ["bgHover", "--color-bg-hover"],
  ["textPrimary", "--color-text-primary"],
  ["textSecondary", "--color-text-secondary"],
  ["textMuted", "--color-text-muted"],
  ["accent", "--color-accent"],
  ["accent2", "--color-accent-2"],
  ["success", "--color-success"],
  ["warning", "--color-warning"],
  ["danger", "--color-danger"],
  ["info", "--color-info"],
];

const THEME_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Normalize loose hex input (`abc`, `#ABCDEF`) to lowercase `#rrggbb`. */
export function normalizeHexInput(value: string): string | null {
  const v = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    const [r, g, b] = v;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  return null;
}

/** Coerce a persisted/imported palette into valid hex, or return null if any seed is bad. */
export function sanitizeCustomThemeColors(input: unknown): CustomThemeColors | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const out = {} as CustomThemeColors;
  for (const { key } of THEME_COLOR_FIELDS) {
    const raw = source[key];
    const hex = typeof raw === "string" ? normalizeHexInput(raw) : null;
    if (!hex) return null;
    out[key] = hex;
  }
  return out;
}

/** Whether a background is light enough to need the light shadow/scrim ladder. */
export function detectMode(colors: Pick<CustomThemeColors, "bgPrimary">): CustomThemeMode {
  const rgb = hexToRgb(colors.bgPrimary);
  return luminance(rgb) > 0.5 ? "light" : "dark";
}

/** WCAG contrast between the seed text and background — drives the editor warning. */
export function seedContrastRatio(colors: CustomThemeColors): number {
  try {
    return contrastRatio(colors.textPrimary, colors.bgPrimary);
  } catch {
    return 21;
  }
}

export function slugifyThemeName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "theme";
}

/** Stable, collision-free id for a custom theme (deterministic for tests). */
export function createCustomThemeId(name: string, existingIds: string[]): string {
  const base = `custom-${slugifyThemeName(name)}`;
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export type ThemeNameError = "required" | "duplicate" | "tooLong" | null;

export function validateThemeName(
  name: string,
  themes: Array<{ id: string; meta: { name: string; isCustom?: boolean } }>,
  editingId: string | null
): ThemeNameError {
  const trimmed = name.trim();
  if (!trimmed) return "required";
  if (trimmed.length > 40) return "tooLong";
  const taken = themes.some(
    (t) =>
      t.id !== editingId &&
      t.meta.isCustom &&
      t.meta.name.trim().toLowerCase() === trimmed.toLowerCase()
  );
  return taken ? "duplicate" : null;
}

// ── Export / import ────────────────────────────────────────────────────

export const THEME_EXPORT_TYPE = "gameindex-theme";
export const THEME_EXPORT_VERSION = 1;

export interface ImportedTheme {
  name: string;
  colors: CustomThemeColors;
  mode: CustomThemeMode;
  sourceId?: string;
}

export type ThemeImportErrorCode = "invalidJson" | "noThemes" | "invalidTheme";

export interface ThemeImportIssue {
  code: ThemeImportErrorCode;
  detail?: string;
}

export interface ThemeImportResult {
  themes: ImportedTheme[];
  errors: ThemeImportIssue[];
}

export function serializeThemeExport(input: {
  name: string;
  colors: CustomThemeColors;
  mode: CustomThemeMode;
}): string {
  return JSON.stringify(
    {
      type: THEME_EXPORT_TYPE,
      version: THEME_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      theme: {
        name: input.name.trim(),
        colors: input.colors,
        mode: input.mode,
      },
    },
    null,
    2
  );
}

export function downloadThemeExport(input: {
  name: string;
  colors: CustomThemeColors;
  mode: CustomThemeMode;
}): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([serializeThemeExport(input)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `gameindex-theme-${slugifyThemeName(input.name)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function coerceImportedTheme(entry: unknown): ImportedTheme | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  const meta =
    obj.meta && typeof obj.meta === "object" ? (obj.meta as Record<string, unknown>) : null;
  const rawName =
    typeof meta?.name === "string"
      ? meta.name
      : typeof obj.name === "string"
        ? obj.name
        : "";
  const name = rawName.trim().slice(0, 40);
  if (!name) return null;
  const colors = sanitizeCustomThemeColors(obj.colors);
  if (!colors) return null;
  const mode =
    obj.mode === "light" || obj.mode === "dark" ? obj.mode : detectMode(colors);
  return {
    name,
    colors,
    mode,
    sourceId: typeof obj.id === "string" ? obj.id : undefined,
  };
}

function importIssueDetail(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const obj = entry as Record<string, unknown>;
  const meta =
    obj.meta && typeof obj.meta === "object" ? (obj.meta as Record<string, unknown>) : null;
  if (typeof meta?.name === "string" && meta.name.trim()) return meta.name.trim();
  if (typeof obj.name === "string" && obj.name.trim()) return obj.name.trim();
  return undefined;
}

/**
 * Read a theme file. Accepts a bare theme object, an array of themes, a
 * `{ themes: [...] }` bundle, or the versioned export envelope so files can
 * be hand-edited and older shapes keep working.
 */
export function parseThemeImport(text: string): ThemeImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { themes: [], errors: [{ code: "invalidJson" }] };
  }

  let candidates: unknown[];
  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.themes)) candidates = obj.themes;
    else if (obj.theme !== undefined) candidates = [obj.theme];
    else candidates = [parsed];
  } else {
    return { themes: [], errors: [{ code: "noThemes" }] };
  }

  const themes: ImportedTheme[] = [];
  const errors: ThemeImportIssue[] = [];
  for (const candidate of candidates) {
    const theme = coerceImportedTheme(candidate);
    if (theme) themes.push(theme);
    else errors.push({ code: "invalidTheme", detail: importIssueDetail(candidate) });
  }
  if (themes.length === 0 && errors.length === 0) errors.push({ code: "noThemes" });
  return { themes, errors };
}

/** Append " (2)", " (3)"… until the name is free among custom themes. */
export function dedupeThemeName(name: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const base = name.trim();
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`.toLowerCase())) n += 1;
  return `${base} (${n})`;
}

function mix(a: string, aPercent: number, b: string): string {
  return `color-mix(in srgb, ${a} ${aPercent}%, ${b})`;
}

const LIGHT_ELEVATION: Record<string, string> = {
  "--elevation-1": "0 1px 2px rgba(15, 23, 42, 0.05)",
  "--elevation-2": "0 1px 3px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.05)",
  "--elevation-3": "0 2px 6px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.07)",
  "--elevation-4": "0 4px 10px rgba(15, 23, 42, 0.07), 0 16px 40px rgba(15, 23, 42, 0.08)",
  "--elevation-5": "0 8px 20px rgba(15, 23, 42, 0.09), 0 32px 80px rgba(15, 23, 42, 0.12)",
  "--shadow-xs": "var(--elevation-1)",
  "--shadow-sm": "var(--elevation-2)",
  "--shadow-md": "var(--elevation-3)",
  "--shadow-lg": "var(--elevation-4)",
  "--shadow-xl": "var(--elevation-5)",
};

/**
 * Resolve the full token set for a custom theme. Kept separate from the
 * CSS wrapper so the live preview can apply the exact same tokens inline.
 */
export function buildThemeTokens(
  colors: CustomThemeColors,
  mode: CustomThemeMode
): Record<string, string> {
  const isDark = mode === "dark";
  const { accent, accent2, bgPrimary, bgSecondary } = colors;

  const tokens: Record<string, string> = {
    "color-scheme": mode,

    "--color-bg-primary": bgPrimary,
    "--color-bg-secondary": bgSecondary,
    "--color-bg-tertiary": colors.bgTertiary,
    "--color-bg-hover": colors.bgHover,
    "--color-bg-active": mix(colors.bgHover, 80, accent),
    "--color-bg-gradient": `radial-gradient(ellipse 86% 70% at 50% -12%, ${mix(
      accent,
      isDark ? 14 : 8,
      bgPrimary
    )} 0%, ${bgSecondary} 48%, ${bgPrimary} 100%)`,

    "--color-surface": "var(--color-bg-secondary)",
    "--color-surface-raised": "var(--color-bg-tertiary)",
    "--color-surface-overlay": isDark
      ? mix(bgPrimary, 92, "transparent")
      : "rgba(15, 23, 42, 0.42)",
    "--color-surface-glass": mix(bgSecondary, isDark ? 75 : 80, "transparent"),

    "--color-border": mix(colors.textPrimary, 10, "transparent"),
    "--color-border-light": mix(colors.textPrimary, 14, "transparent"),
    "--color-border-highlight": mix(colors.textPrimary, 16, "transparent"),
    "--color-border-faint": mix(colors.textPrimary, 5.5, "transparent"),
    "--color-border-glow": mix(accent, 40, "transparent"),

    "--color-text-primary": colors.textPrimary,
    "--color-text-secondary": colors.textSecondary,
    "--color-text-tertiary": mix(colors.textSecondary, 72, bgPrimary),
    "--color-text-muted": colors.textMuted,
    "--color-text-inverse": isDark ? bgPrimary : "#f8fafc",

    "--color-accent": accent,
    "--color-accent-2": accent2,
    "--color-accent-contrast": textColorFor(accent),
    "--color-accent-hover": mix(accent, 85, isDark ? "white" : "black"),
    "--color-accent-active": mix(accent, isDark ? 75 : 70, "black"),
    "--color-accent-glow": mix(accent, isDark ? 30 : 16, "transparent"),
    "--color-accent-soft": mix(accent, isDark ? 13 : 10, bgSecondary),
    "--color-accent-border": mix(accent, isDark ? 35 : 28, "transparent"),
    "--color-accent-surface": mix(accent, isDark ? 6 : 5, bgSecondary),
    "--color-accent-subtle": mix(accent, 4, "transparent"),
    "--color-accent-badge": mix(accent, isDark ? 15 : 12, bgSecondary),
    "--color-accent-laser": "var(--color-accent)",
    "--color-accent-gradient": "var(--color-accent)",
    "--color-accent-gradient-strong": "var(--color-accent)",

    "--brand-1": "var(--color-accent)",
    "--brand-2": "var(--color-accent-2)",
    "--brand-3": "var(--color-accent-hover)",
    "--brand-4": "var(--color-accent)",
    "--brand-gradient": `linear-gradient(135deg, ${accent} 0%, ${accent2} 100%)`,
    "--brand-gradient-strong": `linear-gradient(135deg, ${accent} 0%, ${accent2} 100%)`,
    "--mesh-gradient": [
      `radial-gradient(ellipse 78% 55% at 18% -8%, ${mix(accent, isDark ? 9 : 8, "transparent")} 0%, transparent 62%)`,
      `radial-gradient(ellipse 62% 48% at 88% 0%, ${mix(accent2, isDark ? 7 : 6, "transparent")} 0%, transparent 58%)`,
      `radial-gradient(ellipse 92% 36% at 50% 102%, ${mix(accent, isDark ? 5 : 4, "transparent")} 0%, transparent 70%)`,
    ].join(", "),

    "--color-success": colors.success,
    "--color-warning": colors.warning,
    "--color-danger": colors.danger,
    "--color-info": colors.info,
    "--color-stale": colors.warning,

    "--shadow-glow": isDark
      ? "0 0 20px var(--color-accent-glow)"
      : "0 0 0 1px var(--color-border-glow), 0 0 18px var(--color-accent-glow)",
  };

  if (!isDark) {
    Object.assign(tokens, LIGHT_ELEVATION, {
      "--accent-glow-strength": "16%",
      "--accent-soft-strength": "9%",
      "--accent-border-strength": "28%",
      "--accent-hover-mix": "black",
      "--color-scrim": "rgba(15, 23, 42, 0.36)",
      "--color-scrim-strong": "rgba(15, 23, 42, 0.55)",
      "--color-focus-ring": mix(accent, 45, "transparent"),
    });
  }

  return tokens;
}

export function buildCustomThemeCss(
  themeId: string,
  colors: CustomThemeColors,
  mode: CustomThemeMode
): string {
  const lines = Object.entries(buildThemeTokens(colors, mode)).map(
    ([key, value]) => `  ${key}: ${value};`
  );
  return `[data-theme="${themeId}"] {\n${lines.join("\n")}\n}`;
}

export function isValidThemeId(id: string): boolean {
  return THEME_ID_RE.test(id);
}

/**
 * Read a built-in theme's seed colors straight from the live stylesheets by
 * temporarily attaching a probe element with that `data-theme`. This keeps
 * "clone from theme" in sync with `themes.css` with no hardcoded palette map.
 */
export function readThemeSeedColors(themeId: string): CustomThemeColors | null {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("div");
  probe.setAttribute("data-theme", themeId);
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;left:-9999px;top:0;width:0;height:0;opacity:0;pointer-events:none;";
  document.body.appendChild(probe);
  try {
    const style = getComputedStyle(probe);
    const colors = {} as CustomThemeColors;
    for (const [key, cssVar] of SEED_VARS) {
      const hex = cssColorStringToHex(style.getPropertyValue(cssVar));
      if (!hex) return null;
      colors[key] = hex;
    }
    return colors;
  } catch {
    return null;
  } finally {
    probe.remove();
  }
}
