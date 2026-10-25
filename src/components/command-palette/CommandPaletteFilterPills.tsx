import type { ReactNode } from "react";
import {
  Building2,
  Calendar,
  Clock,
  Cloud,
  Gamepad2,
  HardDrive,
  Heart,
  History,
  Play,
  Puzzle,
  Sparkles,
  Star,
  Tag,
  ArrowUpDown,
  EyeOff,
  X,
} from "lucide-react";
import type { ParsedQueryFilters } from "./commandPaletteTypes";

interface CommandPaletteFilterPillsProps {
  rawQuery: string;
  parsedFilters: ParsedQueryFilters;
  onSetRawQuery: (q: string) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

interface FilterChip {
  key: string;
  label: string;
  icon: ReactNode;
  pattern: RegExp;
}

const OP_PREFIX: Record<string, string> = { ">": ">", "<": "<", "=": ":" };

/**
 * Only visible when a structured filter is active. The old always-on prompt
 * row duplicated the scope bar and cost 44px of vertical space on every open.
 */
export default function CommandPaletteFilterPills({
  rawQuery,
  parsedFilters,
  onSetRawQuery,
  t,
}: CommandPaletteFilterPillsProps) {
  const chips: FilterChip[] = [];
  const push = (chip: FilterChip) => chips.push(chip);

  if (parsedFilters.isInstalled) {
    push({
      key: "installed",
      label: t("commandPalette.badgeInstalled"),
      icon: <Gamepad2 size={11} />,
      pattern: /(?:\s|^)(?:is:installed|installed:true|\+installed)(?=\s|$)/gi,
    });
  }
  if (parsedFilters.isCloud) {
    push({
      key: "cloud",
      label: t("commandPalette.badgeNotInstalled"),
      icon: <Cloud size={11} />,
      pattern: /(?:\s|^)(?:is:cloud|is:uninstalled|installed:false|!installed|-installed)(?=\s|$)/gi,
    });
  }
  if (parsedFilters.isFavorite) {
    push({
      key: "favorite",
      label: t("commandPalette.promptFavorites"),
      icon: <Heart size={11} fill="currentColor" />,
      pattern: /(?:\s|^)(?:is:fav|is:favorite|fav:true|favorite:true|\+fav)(?=\s|$)/gi,
    });
  }
  if (parsedFilters.excludeFavorite) {
    push({
      key: "no-favorite",
      label: t("commandPalette.filterNoFavorite"),
      icon: <Heart size={11} />,
      pattern: /(?:\s|^)(?:!fav|-fav|fav:false)(?=\s|$)/gi,
    });
  }
  if (parsedFilters.isUnplayed) {
    push({
      key: "unplayed",
      label: t("commandPalette.promptUnplayed"),
      icon: <History size={11} />,
      pattern: /(?:\s|^)(?:is:unplayed|unplayed:true|is:backlog)(?=\s|$)/gi,
    });
  }
  if (parsedFilters.isRunning) {
    push({
      key: "running",
      label: t("commandPalette.badgeRunning"),
      icon: <Play size={11} fill="currentColor" />,
      pattern: /(?:\s|^)(?:is:running|running:true)(?=\s|$)/gi,
    });
  }
  if (parsedFilters.isUntracked) {
    push({
      key: "untracked",
      label: t("commandPalette.filterUntracked"),
      icon: <EyeOff size={11} />,
      pattern: /(?:\s|^)(?:is:untracked|untracked:true)(?=\s|$)/gi,
    });
  }
  if (parsedFilters.isModded) {
    push({
      key: "modded",
      label: t("commandPalette.promptModded"),
      icon: <Puzzle size={11} />,
      pattern: /(?:\s|^)(?:is:modded|is:mo2|mod:true|mo2:true|\+mod|\+mo2)(?=\s|$)/gi,
    });
  }
  if (parsedFilters.platform) {
    push({
      key: "platform",
      label: `platform:${parsedFilters.platform}`,
      icon: <Gamepad2 size={11} />,
      pattern: new RegExp(`(?:\\s|^)platform:${parsedFilters.platform}(?=\\s|$)`, "gi"),
    });
  }
  if (parsedFilters.isWishlisted) {
    push({
      key: "wishlisted",
      label: t("commandPalette.scopeWishlist"),
      icon: <Heart size={11} />,
      pattern: /(?:\s|^)(?:is:wishlist(?:ed)?|wishlist:true)(?=\s|$)/gi,
    });
  }
  if (parsedFilters.source) {
    push({
      key: "source",
      label: parsedFilters.source.toUpperCase(),
      icon: <Sparkles size={11} />,
      pattern: new RegExp(
        `(?:\\s|^)(?:source|from|store):${parsedFilters.source}(?=\\s|$)`,
        "gi"
      ),
    });
  }
  if (parsedFilters.genre) {
    push({
      key: "genre",
      label: parsedFilters.genre,
      icon: <Tag size={11} />,
      pattern: new RegExp(`(?:\\s|^)(?:genre|g):${parsedFilters.genre}(?=\\s|$)`, "gi"),
    });
  }
  if (parsedFilters.tag) {
    push({
      key: "tag",
      label: `#${parsedFilters.tag}`,
      icon: <Tag size={11} />,
      pattern: new RegExp(`(?:\\s|^)(?:tag|t):${parsedFilters.tag}(?=\\s|$)`, "gi"),
    });
  }
  if (parsedFilters.developer) {
    push({
      key: "developer",
      label: parsedFilters.developer,
      icon: <Building2 size={11} />,
      pattern: new RegExp(
        `(?:\\s|^)(?:dev|developer):${parsedFilters.developer}(?=\\s|$)`,
        "gi"
      ),
    });
  }
  if (parsedFilters.publisher) {
    push({
      key: "publisher",
      label: parsedFilters.publisher,
      icon: <Building2 size={11} />,
      pattern: new RegExp(
        `(?:\\s|^)(?:pub|publisher):${parsedFilters.publisher}(?=\\s|$)`,
        "gi"
      ),
    });
  }
  if (parsedFilters.year !== undefined) {
    const op = parsedFilters.yearOp || "=";
    push({
      key: "year",
      label: `year${OP_PREFIX[op]}${parsedFilters.year}`,
      icon: <Calendar size={11} />,
      pattern: /(?:\s|^)year:[<>]?\d{4}(?=\s|$)/gi,
    });
  }
  if (parsedFilters.rating !== undefined) {
    const op = parsedFilters.ratingOp || "=";
    push({
      key: "rating",
      label: `rating${OP_PREFIX[op]}${parsedFilters.rating}`,
      icon: <Star size={11} />,
      pattern: /(?:\s|^)(?:rating|score):[<>]?[\d.]+(?=\s|$)/gi,
    });
  }
  if (parsedFilters.playtimeHours !== undefined) {
    const op = parsedFilters.playtimeOp || "=";
    push({
      key: "playtime",
      label: `playtime${OP_PREFIX[op]}${parsedFilters.playtimeHours}h`,
      icon: <Clock size={11} />,
      pattern: /(?:\s|^)(?:playtime|time|hours):[<>]?[\d.]+(?:h|m)?(?=\s|$)/gi,
    });
  }
  if (parsedFilters.sizeBytes !== undefined) {
    const op = parsedFilters.sizeOp || "=";
    push({
      key: "size",
      label: `size${OP_PREFIX[op]}…`,
      icon: <HardDrive size={11} />,
      pattern: /(?:\s|^)(?:size|disk):[<>]?[\d.]+(?:b|kb|mb|gb|tb)?(?=\s|$)/gi,
    });
  }
  if (parsedFilters.sort) {
    push({
      key: "sort",
      label: `sort:${parsedFilters.sort}`,
      icon: <ArrowUpDown size={11} />,
      pattern: /(?:\s|^)sort:[a-z]+(?=\s|$)/gi,
    });
  }

  if (chips.length === 0) return null;

  const remove = (pattern: RegExp) => {
    onSetRawQuery(rawQuery.replace(pattern, " ").replace(/\s{2,}/g, " ").trim());
  };

  return (
    <div className="cp-filters" role="toolbar" aria-label={t("commandPalette.activeFilters")}>
      <span className="cp-filters-label">{t("commandPalette.activeFilters")}</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="cp-filter"
          onClick={() => remove(chip.pattern)}
          aria-label={`${t("commandPalette.removeFilter")}: ${chip.label}`}
        >
          {chip.icon}
          <span>{chip.label}</span>
          <X size={10} aria-hidden="true" />
        </button>
      ))}
      <button type="button" className="cp-filter-clear" onClick={() => onSetRawQuery("")}>
        {t("commandPalette.clearFilters")}
      </button>
    </div>
  );
}
