import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildCustomThemeCss,
  detectMode,
  isValidThemeId,
  sanitizeCustomThemeColors,
  type CustomThemeColors,
  type CustomThemeMode,
} from "../utils/customTheme";

/**
 * Describes the "feel" of a theme so the UI can tag it with the right
 * emoji/label (e.g. "🎮 Vibrant", "🧘 Calm", "♿ High-Contrast").
 */
export type ThemeDescriptor = "vibrant" | "calm" | "high-contrast" | "minimal" | "adaptive";

export interface ThemeMeta {
  name: string;
  descriptor: ThemeDescriptor;
  author?: string;
  createdAt?: string;
  isCustom?: boolean;
}

export interface ThemeConfig {
  id: string;
  meta: ThemeMeta;
  /** Seed colors + resolved scheme. Present only on user-authored themes. */
  colors?: CustomThemeColors;
  mode?: CustomThemeMode;
}

export type UiStyleId = "classic" | "materialyou" | "steam" | "epic" | "modern" | "liquidglass";

export interface UiStyleConfig {
  id: UiStyleId;
  name: string;
  badge: string;
  desc: string;
  themeId: string;
}

export const UI_STYLES: UiStyleConfig[] = [
  {
    id: "classic",
    name: "Classic",
    badge: "Default",
    desc: "Original balanced gaming aesthetic with tactile borders and clean geometry.",
    themeId: "dark",
  },
  {
    id: "materialyou",
    name: "Material You 3",
    badge: "M3 Expressive",
    desc: "Tonal container surfaces, hyper-rounded pills, and soft elevation.",
    themeId: "materialyou",
  },
  {
    id: "steam",
    name: "Steam Client",
    badge: "Valve Gaming",
    desc: "Industrial charcoal-navy, linear gradient header, and boxy cyan buttons.",
    themeId: "steam",
  },
  {
    id: "epic",
    name: "Epic Launcher",
    badge: "Stealth Flat",
    desc: "Flat obsidian slabs, sharp micro-radii, and bold uppercase action buttons.",
    themeId: "epic",
  },
  {
    id: "modern",
    name: "Neo-Modern",
    badge: "Studio Minimal",
    desc: "Hairline 1px precision borders, zinc-950 canvas, and top spotlight wash.",
    themeId: "modern",
  },
  {
    id: "liquidglass",
    name: "Liquid Glass",
    badge: "Frosted Acrylic",
    desc: "Translucent frosted glass layers floating over an iridescent aurora mesh.",
    themeId: "liquidglass",
  },
];

/** Well-known built-in themes. */
const BUILTIN_THEMES: ThemeConfig[] = [
  {
    id: "adaptive",
    meta: { name: "Adaptive", descriptor: "adaptive" },
  },
  {
    id: "dark",
    meta: { name: "Classic", descriptor: "vibrant" },
  },
  {
    id: "materialyou",
    meta: { name: "Material You 3", descriptor: "vibrant" },
  },
  {
    id: "steam",
    meta: { name: "Steam Client", descriptor: "vibrant" },
  },
  {
    id: "epic",
    meta: { name: "Epic Launcher", descriptor: "minimal" },
  },
  {
    id: "modern",
    meta: { name: "Neo-Modern", descriptor: "minimal" },
  },
  {
    id: "liquidglass",
    meta: { name: "Liquid Glass", descriptor: "vibrant" },
  },
  {
    id: "light",
    meta: { name: "Light Mode", descriptor: "minimal" },
  },
  {
    id: "nord",
    meta: { name: "Nord Ice", descriptor: "calm" },
  },
  {
    id: "cyberpunk",
    meta: { name: "Cyberpunk", descriptor: "vibrant" },
  },
  {
    id: "emerald",
    meta: { name: "Emerald", descriptor: "calm" },
  },
  {
    id: "dracula",
    meta: { name: "Dracula", descriptor: "vibrant" },
  },
  {
    id: "solarized",
    meta: { name: "Solarized", descriptor: "calm" },
  },
  {
    id: "tokyonight",
    meta: { name: "Tokyo Night", descriptor: "calm" },
  },
  {
    id: "gruvbox",
    meta: { name: "Gruvbox", descriptor: "minimal" },
  },
  {
    id: "catppuccin",
    meta: { name: "Catppuccin", descriptor: "vibrant" },
  },
  {
    id: "sunset",
    meta: { name: "Sunset", descriptor: "vibrant" },
  },
  {
    id: "oceanic",
    meta: { name: "Oceanic", descriptor: "calm" },
  },
  {
    id: "rosepine",
    meta: { name: "Rose Pine", descriptor: "minimal" },
  },
  {
    id: "synthwave",
    meta: { name: "Synthwave", descriptor: "vibrant" },
  },
  {
    id: "forest",
    meta: { name: "Forest", descriptor: "calm" },
  },
  {
    id: "desert",
    meta: { name: "Desert Mirage", descriptor: "minimal" },
  },
  {
    id: "aurora",
    meta: { name: "Aurora", descriptor: "vibrant" },
  },
  {
    id: "oled",
    meta: { name: "Midnight OLED", descriptor: "minimal" },
  },
  {
    id: "highcontrast",
    meta: { name: "High Contrast", descriptor: "high-contrast" },
  },
];

const STORAGE_KEY = "gamelib-theme";
const SYSTEM_SYNC_KEY = "gamelib-theme-system-sync";
const CUSTOM_THEMES_KEY = "gamelib-custom-themes";
const UI_STYLE_STORAGE_KEY = "gamelib-ui-style";

// ── Helpers ────────────────────────────────────────────────────────────

function loadCustomThemes(): ThemeConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return [];
    const parsed: Array<{ id?: string; meta?: ThemeMeta; colors?: unknown; mode?: string }> =
      JSON.parse(raw);
    const custom: ThemeConfig[] = [];
    for (const entry of parsed) {
      const colors = sanitizeCustomThemeColors(entry.colors);
      if (!entry.id || !isValidThemeId(entry.id) || !colors || !entry.meta?.name) continue;
      custom.push({
        id: entry.id,
        meta: { ...entry.meta, isCustom: true },
        colors,
        mode: entry.mode === "light" || entry.mode === "dark" ? entry.mode : detectMode(colors),
      });
    }
    return custom;
  } catch {
    return [];
  }
}

function applyTheme(themeId: string) {
  document.documentElement.setAttribute("data-theme", themeId);
}

function applyUiStyle(styleId: string) {
  document.documentElement.setAttribute("data-ui-style", styleId);
}

function resolveSystemTheme(): "dark" | "light" {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

function persistCustomThemes(themes: ThemeConfig[]) {
  try {
    const custom = themes.filter(
      (t) => t.meta.isCustom && !BUILTIN_THEMES.some((b) => b.id === t.id)
    );
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(custom));
  } catch {
    /* ignore */
  }
}

const CUSTOM_STYLE_EL_ID = "gamelib-custom-themes";

// ── Context type ───────────────────────────────────────────────────────

interface ThemeContextValue {
  /** Currently active theme id. */
  currentTheme: string;
  /** Switch to a theme by id. Persisted to localStorage. */
  setTheme: (themeId: string) => void;
  /** All available themes (builtin + custom). */
  themes: ThemeConfig[];
  /** Add a user-defined custom theme. */
  addCustomTheme: (theme: ThemeConfig) => void;
  /** Remove a user-defined custom theme. No-op on builtins. */
  removeCustomTheme: (themeId: string) => void;
  /** Whether the system-preference sync toggle is on. */
  systemSync: boolean;
  /** Toggle system preference sync. */
  setSystemSync: (on: boolean) => void;
  /** Currently active overall UI style id. */
  uiStyle: UiStyleId;
  /** Switch to a UI style by id. Persisted to localStorage. */
  setUiStyle: (styleId: UiStyleId) => void;
}

// Persist the React context instance across Vite HMR module re-evaluations so
// lazy-loaded page chunks never lose their Provider instance.
const globalThemeObj = globalThis as unknown as {
  __gamelib_theme_context__?: React.Context<ThemeContextValue | null>;
};
const ThemeContext =
  globalThemeObj.__gamelib_theme_context__ ??
  (globalThemeObj.__gamelib_theme_context__ = createContext<ThemeContextValue | null>(null));

// ── Provider ───────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [customThemes, setCustomThemes] = useState<ThemeConfig[]>(loadCustomThemes);
  const themes = useMemo(() => [...BUILTIN_THEMES, ...customThemes], [customThemes]);

  const [systemSync, setSystemSyncState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SYSTEM_SYNC_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [currentTheme, setCurrentThemeState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "dark";
    } catch {
      return "dark";
    }
  });

  const [uiStyle, setUiStyleState] = useState<UiStyleId>(() => {
    try {
      const saved = localStorage.getItem(UI_STYLE_STORAGE_KEY) as UiStyleId;
      if (saved && UI_STYLES.some((s) => s.id === saved)) return saved;
      return "classic";
    } catch {
      return "classic";
    }
  });

  // Apply theme on mount and on change
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  // Apply UI style on mount and on change
  useEffect(() => {
    applyUiStyle(uiStyle);
  }, [uiStyle]);

  // Custom themes live in localStorage, not in themes.css, so their token
  // blocks are generated and injected as a single runtime stylesheet.
  useEffect(() => {
    const blocks = themes
      .filter((t) => t.meta.isCustom && t.colors && isValidThemeId(t.id))
      .map((t) =>
        buildCustomThemeCss(t.id, t.colors as CustomThemeColors, t.mode ?? detectMode(t.colors as CustomThemeColors))
      );
    let el = document.getElementById(CUSTOM_STYLE_EL_ID) as HTMLStyleElement | null;
    if (blocks.length === 0) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = CUSTOM_STYLE_EL_ID;
      document.head.appendChild(el);
    }
    el.textContent = blocks.join("\n\n");
  }, [themes]);

  // Mirror the active theme to the backend kv store (get_theme /
  // set_theme) so the native splash window can apply the last-used
  // theme on next launch — it can't read this window's localStorage.
  useEffect(() => {
    invoke("set_theme", { theme: currentTheme }).catch(() => {
      /* non-fatal */
    });
  }, [currentTheme]);

  // Listen for OS color-scheme changes when systemSync is on
  useEffect(() => {
    if (!systemSync) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const osTheme = resolveSystemTheme();
      setCurrentThemeState(osTheme);
      try {
        localStorage.setItem(STORAGE_KEY, osTheme);
      } catch {
        /* ignore */
      }
    };
    mq.addEventListener("change", handler);
    // Immediately sync to current OS preference
    handler();
    return () => mq.removeEventListener("change", handler);
  }, [systemSync]);

  const setTheme = useCallback(
    (themeId: string) => {
      setCurrentThemeState(themeId);
      try {
        localStorage.setItem(STORAGE_KEY, themeId);
      } catch {
        /* ignore */
      }
    },
    []
  );

  const setUiStyle = useCallback(
    (styleId: UiStyleId) => {
      setUiStyleState(styleId);
      try {
        localStorage.setItem(UI_STYLE_STORAGE_KEY, styleId);
      } catch {
        /* ignore */
      }
    },
    []
  );

  const setSystemSync = useCallback(
    (on: boolean) => {
      setSystemSyncState(on);
      try {
        localStorage.setItem(SYSTEM_SYNC_KEY, String(on));
      } catch {
        /* ignore */
      }
      if (on) {
        const osTheme = resolveSystemTheme();
        setCurrentThemeState(osTheme);
        try {
          localStorage.setItem(STORAGE_KEY, osTheme);
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  const addCustomTheme = useCallback((theme: ThemeConfig) => {
    setCustomThemes((prev) => {
      const filtered = prev.filter((t) => t.id !== theme.id);
      const next = [...filtered, { ...theme, meta: { ...theme.meta, isCustom: true } }];
      persistCustomThemes(next);
      return next;
    });
  }, []);

  const removeCustomTheme = useCallback((themeId: string) => {
    // Never remove builtins
    if (BUILTIN_THEMES.some((b) => b.id === themeId)) return;
    setCustomThemes((prev) => {
      const next = prev.filter((t) => t.id !== themeId);
      persistCustomThemes(next);
      return next;
    });
    // If the removed theme was active, fall back to dark
    if (currentTheme === themeId) {
      setTheme("dark");
    }
  }, [currentTheme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      currentTheme,
      setTheme,
      themes,
      addCustomTheme,
      removeCustomTheme,
      systemSync,
      setSystemSync,
      uiStyle,
      setUiStyle,
    }),
    [currentTheme, setTheme, themes, addCustomTheme, removeCustomTheme, systemSync, setSystemSync, uiStyle, setUiStyle]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
