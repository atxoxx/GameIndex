import type { ReactNode } from "react";
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
  Play,
  Tag,
  Building2,
  Calendar,
  Star,
  Clock,
  HardDrive,
  ArrowUpDown,
  EyeOff,
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

interface FilterChip {
  key: string;
  label: string;
  icon: ReactNode;
  onRemove: () => void;
}

const OP_PREFIX: Record<string, string> = { ">": ">", "<": "<", "=": ":" };

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
      const regex = new RegExp(`(?:\\s|^)${token}(?=\\s|$)`, "gi");
      const updated = rawQuery.replace(regex, " ").replace(/\s{2,}/g, " ").trim();
      onSetRawQuery(updated);
    } else {
      const trimmed = rawQuery.trim();
      onSetRawQuery(trimmed ? `${trimmed} ${token}` : `${token} `);
    }
  };

  const removeByPattern = (pattern: RegExp) => {
    onSetRawQuery(rawQuery.replace(pattern, " ").replace(/\s{2,}/g, " ").trim());
  };

  // When query is empty, show quick action prompts
  if (rawQuery.trim() === "") {
    return (
      <div className="cmd-prompt-chips-bar" role="toolbar" aria-label="Quick Prompts">
        <button type="button" className="cmd-prompt-chip" onClick={onRollRandomGame}>
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

        <button type="button" className="cmd-prompt-chip" onClick={onOpenCheatSheet}>
          <HelpCircle size={12} className="cmd-prompt-chip-icon" />
          <span>{t("commandPalette.promptHelp")}</span>
        </button>
      </div>
    );
  }

  const chips: FilterChip[] = [];

  if (parsedFilters.isInstalled) {
    chips.push({
      key: "installed",
      label: t("commandPalette.badgeInstalled"),
      icon: <Gamepad2 size={11} />,
      onRemove: () => toggleFilterToken("is:installed", true),
    });
  }
  if (parsedFilters.isCloud) {
    chips.push({
      key: "cloud",
      label: t("commandPalette.badgeNotInstalled"),
      icon: <Cloud size={11} />,
      onRemove: () =>
        removeByPattern(/(?:\s|^)(?:is:cloud|is:uninstalled|installed:false|!installed|-installed)(?=\s|$)/gi),
    });
  }
  if (parsedFilters.isFavorite) {
    chips.push({
      key: "favorite",
      label: t("commandPalette.promptFavorites"),
      icon: <Heart size={11} fill="currentColor" />,
      onRemove: () => toggleFilterToken("is:fav", true),
    });
  }
  if (parsedFilters.excludeFavorite) {
    chips.push({
      key: "no-favorite",
      label: t("commandPalette.filterNoFavorite"),
      icon: <Heart size={11} />,
      onRemove: () => removeByPattern(/(?:\s|^)(?:!fav|-fav|fav:false)(?=\s|$)/gi),
    });
  }
  if (parsedFilters.isUnplayed) {
    chips.push({
      key: "unplayed",
      label: t("commandPalette.promptUnplayed"),
      icon: <History size={11} />,
      onRemove: () =>
        removeByPattern(/(?:\s|^)(?:is:unplayed|unplayed:true|is:backlog)(?=\s|$)/gi),
    });
  }
  if (parsedFilters.isRunning) {
    chips.push({
      key: "running",
      label: t("commandPalette.badgeRunning"),
      icon: <Play size={11} fill="currentColor" />,
      onRemove: () => removeByPattern(/(?:\s|^)(?:is:running|running:true)(?=\s|$)/gi),
    });
  }
  if (parsedFilters.isUntracked) {
    chips.push({
      key: "untracked",
      label: t("commandPalette.filterUntracked"),
      icon: <EyeOff size={11} />,
      onRemove: () => removeByPattern(/(?:\s|^)(?:is:untracked|untracked:true)(?=\s|$)/gi),
    });
  }
  if (parsedFilters.isWishlisted) {
    chips.push({
      key: "wishlisted",
      label: t("commandPalette.scopeWishlist"),
      icon: <Heart size={11} />,
      onRemove: () =>
        removeByPattern(/(?:\s|^)(?:is:wishlist(?:ed)?|wishlist:true)(?=\s|$)/gi),
    });
  }
  if (parsedFilters.source) {
    chips.push({
      key: "source",
      label: parsedFilters.source.toUpperCase(),
      icon: <Sparkles size={11} />,
      onRemove: () =>
        removeByPattern(
          new RegExp(
            `(?:\\s|^)(?:source|from|store):${parsedFilters.source}(?=\\s|$)`,
            "gi"
          )
        ),
    });
  }
  if (parsedFilters.genre) {
    chips.push({
      key: "genre",
      label: parsedFilters.genre,
      icon: <Tag size={11} />,
      onRemove: () =>
        removeByPattern(
          new RegExp(`(?:\\s|^)(?:genre|g):${parsedFilters.genre}(?=\\s|$)`, "gi")
        ),
    });
  }
  if (parsedFilters.tag) {
    chips.push({
      key: "tag",
      label: `#${parsedFilters.tag}`,
      icon: <Tag size={11} />,
      onRemove: () =>
        removeByPattern(new RegExp(`(?:\\s|^)(?:tag|t):${parsedFilters.tag}(?=\\s|$)`, "gi")),
    });
  }
  if (parsedFilters.developer) {
    chips.push({
      key: "developer",
      label: parsedFilters.developer,
      icon: <Building2 size={11} />,
      onRemove: () =>
        removeByPattern(
          new RegExp(`(?:\\s|^)(?:dev|developer):${parsedFilters.developer}(?=\\s|$)`, "gi")
        ),
    });
  }
  if (parsedFilters.publisher) {
    chips.push({
      key: "publisher",
      label: parsedFilters.publisher,
      icon: <Building2 size={11} />,
      onRemove: () =>
        removeByPattern(
          new RegExp(`(?:\\s|^)(?:pub|publisher):${parsedFilters.publisher}(?=\\s|$)`, "gi")
        ),
    });
  }
  if (parsedFilters.year !== undefined) {
    const op = parsedFilters.yearOp || "=";
    chips.push({
      key: "year",
      label: `year${OP_PREFIX[op]}${parsedFilters.year}`,
      icon: <Calendar size={11} />,
      onRemove: () =>
        removeByPattern(/(?:\s|^)year:[<>]?\d{4}(?=\s|$)/gi),
    });
  }
  if (parsedFilters.rating !== undefined) {
    const op = parsedFilters.ratingOp || "=";
    chips.push({
      key: "rating",
      label: `rating${OP_PREFIX[op]}${parsedFilters.rating}`,
      icon: <Star size={11} />,
      onRemove: () =>
        removeByPattern(/(?:\s|^)(?:rating|score):[<>]?[\d.]+(?=\s|$)/gi),
    });
  }
  if (parsedFilters.playtimeHours !== undefined) {
    const op = parsedFilters.playtimeOp || "=";
    chips.push({
      key: "playtime",
      label: `playtime${OP_PREFIX[op]}${parsedFilters.playtimeHours}h`,
      icon: <Clock size={11} />,
      onRemove: () =>
        removeByPattern(/(?:\s|^)(?:playtime|time|hours):[<>]?[\d.]+(?:h|m)?(?=\s|$)/gi),
    });
  }
  if (parsedFilters.sizeBytes !== undefined) {
    const op = parsedFilters.sizeOp || "=";
    chips.push({
      key: "size",
      label: `size${OP_PREFIX[op]}…`,
      icon: <HardDrive size={11} />,
      onRemove: () =>
        removeByPattern(/(?:\s|^)(?:size|disk):[<>]?[\d.]+(?:b|kb|mb|gb|tb)?(?=\s|$)/gi),
    });
  }
  if (parsedFilters.sort) {
    chips.push({
      key: "sort",
      label: `sort:${parsedFilters.sort}`,
      icon: <ArrowUpDown size={11} />,
      onRemove: () => removeByPattern(/(?:\s|^)sort:[a-z]+(?=\s|$)/gi),
    });
  }

  return (
    <div className="cmd-active-filters-bar" role="toolbar" aria-label="Active Filters">
      {/* Always-available quick toggles */}
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

      <button
        type="button"
        className={`cmd-filter-toggle-pill${parsedFilters.isRunning ? " is-active" : ""}`}
        onClick={() => toggleFilterToken("is:running", !!parsedFilters.isRunning)}
      >
        <Play size={11} />
        <span>{t("commandPalette.badgeRunning")}</span>
        {parsedFilters.isRunning && <X size={10} className="cmd-filter-remove-icon" />}
      </button>

      {/* Active power-filter chips (removable) */}
      {chips
        .filter((c) => !["installed", "favorite", "unplayed", "running"].includes(c.key))
        .map((chip) => (
          <button
            key={chip.key}
            type="button"
            className="cmd-filter-toggle-pill is-active"
            onClick={chip.onRemove}
            aria-label={`${t("commandPalette.removeFilter")}: ${chip.label}`}
          >
            {chip.icon}
            <span>{chip.label}</span>
            <X size={10} className="cmd-filter-remove-icon" />
          </button>
        ))}

      {chips.length > 0 && (
        <button
          type="button"
          className="cmd-filter-clear-all"
          onClick={() => onSetRawQuery("")}
        >
          <X size={10} />
          <span>{t("commandPalette.clearFilters")}</span>
        </button>
      )}
    </div>
  );
}
