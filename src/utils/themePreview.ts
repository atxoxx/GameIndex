import type { ThemeConfig } from "../context/ThemeContext";

/**
 * Preview palette for the theme gallery. Kept in sync with the theme
 * stylesheets by hand: a theme's `[data-theme]` block cannot preview
 * itself when it is not the active theme (the default dark theme lives on
 * `:root` and has no selector of its own), so the pickers paint from this
 * table instead.
 */
export interface ThemePreviewColors {
  bg: string;
  text: string;
  accent: string;
}

export const THEME_PREVIEW_COLORS: Record<string, ThemePreviewColors> = {
  adaptive:    { bg: "#07070d", text: "#f5f6fc", accent: "#7c66ff" },
  dark:        { bg: "#08090c", text: "#f3f5fa", accent: "#635bff" },
  materialyou: { bg: "#141218", text: "#e6e1e5", accent: "#d0bcff" },
  steam:       { bg: "#10151d", text: "#ebeef2", accent: "#66c0f4" },
  epic:        { bg: "#121212", text: "#f5f5f5", accent: "#0078f2" },
  modern:      { bg: "#09090b", text: "#fafafa", accent: "#6366f1" },
  liquidglass: { bg: "#070913", text: "#ffffff", accent: "#00f0ff" },
  light:       { bg: "#f2f5f9", text: "#0f172a", accent: "#6d28d9" },
  nord:        { bg: "#242933", text: "#eceff4", accent: "#88c0d0" },
  cyberpunk:   { bg: "#050508", text: "#f8fafd", accent: "#00f0ff" },
  emerald:     { bg: "#040a06", text: "#f0fdf4", accent: "#10b981" },
  dracula:     { bg: "#181920", text: "#f8f8f2", accent: "#bd93f9" },
  solarized:   { bg: "#001e26", text: "#fdf6e3", accent: "#268bd2" },
  tokyonight:  { bg: "#13141c", text: "#c0caf5", accent: "#7aa2f7" },
  gruvbox:     { bg: "#1d2021", text: "#fbf1c7", accent: "#fe8019" },
  catppuccin:  { bg: "#181825", text: "#cdd6f4", accent: "#cba6f7" },
  sunset:      { bg: "#140710", text: "#fff1f3", accent: "#ff6b6b" },
  oceanic:     { bg: "#030d17", text: "#f0fdfa", accent: "#00e5ff" },
  rosepine:    { bg: "#12101b", text: "#e0def4", accent: "#eb6f92" },
  synthwave:   { bg: "#0f071a", text: "#fbf5ff", accent: "#ff2a85" },
  forest:      { bg: "#060d08", text: "#f2fbf4", accent: "#84cc16" },
  desert:      { bg: "#120c06", text: "#fffbeb", accent: "#e0ab55" },
  aurora:      { bg: "#04030d", text: "#faf5ff", accent: "#9a6bff" },
  oled:        { bg: "#000000", text: "#ffffff", accent: "#3b82f6" },
  highcontrast:{ bg: "#000000", text: "#ffffff", accent: "#ffff00" },
};

/** Preview palette for a built-in or user-created theme. */
export function getThemePreviewColors(theme: ThemeConfig): ThemePreviewColors {
  if (theme.meta.isCustom && theme.colors) {
    return {
      bg: theme.colors.bgPrimary,
      text: theme.colors.textPrimary,
      accent: theme.colors.accent,
    };
  }
  return THEME_PREVIEW_COLORS[theme.id] ?? THEME_PREVIEW_COLORS.dark;
}
