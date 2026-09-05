import {
  Dices,
  Heart,
  Gamepad2,
  History,
  BarChart3,
  HelpCircle,
  X,
  Sparkles,
  Cloud,
} from "lucide-react";
import type { ParsedQueryFilters } from "./commandPaletteTypes";

interface CommandPaletteFilterPillsProps {
  rawQuery: string;
  parsedFilters: ParsedQueryFilters;
  onSetRawQuery: (q: string) => void;
  onRollRandomGame: () => void;
  onOpenCheatSheet: () => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export default function CommandPaletteFilterPills({
  rawQuery,
  parsedFilters,
  onSetRawQuery,
  onRollRandomGame,
  onOpenCheatSheet,
  t,
}: CommandPaletteFilterPillsProps) {
  // Helper to toggle or remove a token in the query
  const toggleFilterToken = (token: string, isActive: boolean) => {
    if (isActive) {
      // Remove token
      const regex = new RegExp(`(?:\\s|^)${token}(?=\\s|$)`, "gi");
      const updated = rawQuery.replace(regex, " ").replace(/\s{2,}/g, " ").trim();
      onSetRawQuery(updated);
    } else {
      // Add token
      const trimmed = rawQuery.trim();
      onSetRawQuery(trimmed ? `${trimmed} ${token}` : `${token} `);
    }
  };

  // When query is empty, show quick action prompts
  if (rawQuery.trim() === "") {
    return (
      <div className="cmd-prompt-chips-bar" role="toolbar" aria-label="Quick Prompts">
        <button
          type="button"
          className="cmd-prompt-chip"
          onClick={onRollRandomGame}
        >
          <Dices size={12} className="cmd-prompt-chip-icon" />
          <span>{t("commandPalette.promptRoll")}</span>
        </button>

        <button
          type="button"
          className="cmd-prompt-chip"
          onClick={() => onSetRawQuery("is:fav ")}
        >
          <Heart size={12} className="cmd-prompt-chip-icon" />
          <span>{t("commandPalette.promptFavorites")}</span>
        </button>

        <button
          type="button"
          className="cmd-prompt-chip"
          onClick={() => onSetRawQuery("is:installed ")}
        >
          <Gamepad2 size={12} className="cmd-prompt-chip-icon" />
          <span>{t("commandPalette.promptInstalled")}</span>
        </button>

        <button
          type="button"
          className="cmd-prompt-chip"
          onClick={() => onSetRawQuery("is:unplayed ")}
        >
          <History size={12} className="cmd-prompt-chip-icon" />
          <span>{t("commandPalette.promptUnplayed")}</span>
        </button>

        <button
          type="button"
          className="cmd-prompt-chip"
          onClick={() => onSetRawQuery("stats")}
        >
          <BarChart3 size={12} className="cmd-prompt-chip-icon" />
          <span>{t("commandPalette.promptStats")}</span>
        </button>

        <button
          type="button"
          className="cmd-prompt-chip"
          onClick={onOpenCheatSheet}
        >
          <HelpCircle size={12} className="cmd-prompt-chip-icon" />
          <span>{t("commandPalette.promptHelp")}</span>
        </button>
      </div>
    );
  }

  // When query has text, show active filter pills or quick toggle pills
  return (
    <div className="cmd-active-filters-bar" role="toolbar" aria-label="Active Filters">
      {/* Quick toggles */}
      <button
        type="button"
        className={`cmd-filter-toggle-pill${parsedFilters.isInstalled ? " is-active" : ""}`}
        onClick={() => toggleFilterToken("is:installed", !!parsedFilters.isInstalled)}
      >
        <Gamepad2 size={11} />
        <span>{t("commandPalette.badgeInstalled")}</span>
        {parsedFilters.isInstalled && <X size={10} className="cmd-filter-remove-icon" />}
      </button>

      <button
        type="button"
        className={`cmd-filter-toggle-pill${parsedFilters.isFavorite ? " is-active" : ""}`}
        onClick={() => toggleFilterToken("is:fav", !!parsedFilters.isFavorite)}
      >
        <Heart size={11} fill={parsedFilters.isFavorite ? "currentColor" : "none"} />
        <span>{t("commandPalette.promptFavorites")}</span>
        {parsedFilters.isFavorite && <X size={10} className="cmd-filter-remove-icon" />}
      </button>

      <button
        type="button"
        className={`cmd-filter-toggle-pill${parsedFilters.isUnplayed ? " is-active" : ""}`}
        onClick={() => toggleFilterToken("is:unplayed", !!parsedFilters.isUnplayed)}
      >
        <History size={11} />
        <span>{t("commandPalette.promptUnplayed")}</span>
        {parsedFilters.isUnplayed && <X size={10} className="cmd-filter-remove-icon" />}
      </button>

      {parsedFilters.isCloud && (
        <button
          type="button"
          className="cmd-filter-toggle-pill is-active"
          onClick={() => toggleFilterToken("is:cloud", true)}
        >
          <Cloud size={11} />
          <span>{t("commandPalette.badgeNotInstalled")}</span>
          <X size={10} className="cmd-filter-remove-icon" />
        </button>
      )}

      {parsedFilters.source && (
        <button
          type="button"
          className="cmd-filter-toggle-pill is-active"
          onClick={() => {
            const regex = new RegExp(`(?:\\s|^)(?:source|from|store):${parsedFilters.source}(?=\\s|$)`, "gi");
            onSetRawQuery(rawQuery.replace(regex, " ").replace(/\s{2,}/g, " ").trim());
          }}
        >
          <Sparkles size={11} />
          <span>{parsedFilters.source.toUpperCase()}</span>
          <X size={10} className="cmd-filter-remove-icon" />
        </button>
      )}

      {parsedFilters.genre && (
        <button
          type="button"
          className="cmd-filter-toggle-pill is-active"
          onClick={() => {
            const regex = new RegExp(`(?:\\s|^)(?:genre|g):${parsedFilters.genre}(?=\\s|$)`, "gi");
            onSetRawQuery(rawQuery.replace(regex, " ").replace(/\s{2,}/g, " ").trim());
          }}
        >
          <span>{parsedFilters.genre}</span>
          <X size={10} className="cmd-filter-remove-icon" />
        </button>
      )}
    </div>
  );
}
