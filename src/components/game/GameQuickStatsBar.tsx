import { useMemo } from "react";
import type { Game, SizeUnit } from "../../types/game";
import {
  costPerHour,
  formatCost,
  formatSize,
  parsePlayTime,
  resolvePurchaseCost,
} from "../../types/game";
import { useSteamGameStats } from "../../hooks/useSteamGameStats";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { StatBand, type StatBandItem } from "../ui/StatBand";
import { IconClock, IconHardDrive, IconStar, IconShield, IconCalendar, IconTag } from "./icons";

interface GameQuickStatsBarProps {
  game: Game;
  steamAppId?: number | null;
  sizeUnit: SizeUnit;
  isStoreMode?: boolean;
  /** Open the edit dialog on the Details tab (used by the empty value
   *  metric so "Set cost" actually takes the user to the field). */
  onSetCost?: () => void;
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

function formatRelativeTime(
  timestamp: number | undefined,
  neverText: string,
  t: Translate
): string {
  if (!timestamp || timestamp <= 0) return neverText;
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return t("game.quickStats.justNow");

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays === 0) {
    if (diffHours === 0) {
      if (diffMin <= 1) return t("game.quickStats.justNow");
      return t("game.quickStats.minutesAgo", { n: diffMin });
    }
    return t("game.quickStats.hoursAgo", { n: diffHours });
  }
  if (diffDays === 1) return t("game.quickStats.yesterday");
  if (diffDays < 30) return t("game.quickStats.daysAgo", { n: diffDays });
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return t("game.quickStats.monthsAgo", { n: months });
  }
  const years = Math.floor(diffDays / 365);
  return t("game.quickStats.yearsAgo", { n: years });
}

function scoreTone(score: number): StatBandItem["tone"] {
  if (score >= 75) return "success";
  if (score >= 50) return "warning";
  return "danger";
}

/** "50.5 GiB" / "0.02 EUR" → a figure plus its caption-sized unit. */
function splitFigure(text: string): { value: string; unit?: string } {
  const space = text.lastIndexOf(" ");
  if (space <= 0) return { value: text };
  return { value: text.slice(0, space), unit: text.slice(space + 1) };
}

/**
 * GameQuickStatsBar — the game overview's quick metrics.
 *
 * Rendered through the shared `StatBand` primitive: figures sit directly on
 * the page with no per-metric tile, so the summary reads as a masthead for
 * the overview rather than a row of widgets. Every metric keeps its own
 * tooltip so the "set cost" affordance still explains itself.
 */
export default function GameQuickStatsBar({
  game,
  steamAppId: steamAppIdProp,
  sizeUnit,
  isStoreMode = false,
  onSetCost,
}: GameQuickStatsBarProps) {
  const { t } = useLanguage();
  const { showDeckVerified } = useSettings();
  const effectiveSteamAppId = steamAppIdProp !== undefined ? steamAppIdProp : game.steamAppId;
  const { data: steamStats } = useSteamGameStats(effectiveSteamAppId ?? undefined);

  // 1. Reception stats
  const ratingScore = game.igdbRating || game.criticRating || null;
  const steamReviews = steamStats?.reviews;
  const steamPositivePercent =
    steamReviews && steamReviews.totalReviews > 0
      ? Math.round((steamReviews.totalPositive / steamReviews.totalReviews) * 100)
      : null;

  // 2. Time to beat & playtime progress
  const ttb = game.timeToBeat;
  const storySeconds = ttb?.normally || ttb?.hastily || 0;
  const storyHours = storySeconds > 0 ? Math.round(storySeconds / 3600) : null;
  const completionistSeconds = ttb?.completely || 0;
  const completionistHours = completionistSeconds > 0 ? Math.round(completionistSeconds / 3600) : null;

  const currentMinutes = parsePlayTime(game.playTime || "0h");
  const currentHours = Math.round((currentMinutes / 60) * 10) / 10;
  const storyProgressPercent =
    storyHours && storyHours > 0 ? Math.min(100, Math.round((currentHours / storyHours) * 100)) : null;

  // 3. Storage
  const sizeValue = game.sizeBytes ?? null;
  const formattedSize = sizeValue != null ? formatSize(sizeValue, sizeUnit) : null;

  // 3b. Value for money — the rate only ever uses a cost the user saved.
  // A store price is not what this copy cost them, and guessing it (then
  // persisting the guess) would make a later real price impossible to
  // distinguish. Playtime still has to clear the noise threshold or the
  // helper returns null.
  const resolvedCost = resolvePurchaseCost(game);
  const valuePerHour =
    resolvedCost != null
      ? costPerHour({
          purchaseCost: resolvedCost.cost,
          purchaseCurrency: resolvedCost.currency,
          playTime: game.playTime,
        })
      : null;

  // 4. Last played
  const lastPlayedRelative = useMemo(() => {
    return formatRelativeTime(game.lastPlayed, t("game.quickStats.neverPlayed"), t);
  }, [game.lastPlayed, t]);

  const items = useMemo<StatBandItem[]>(() => {
    const next: StatBandItem[] = [];
    const sizeFigure = formattedSize ? splitFigure(formattedSize) : null;

    if (ratingScore != null || steamPositivePercent != null) {
      const tone = scoreTone(ratingScore ?? steamPositivePercent ?? 0);
      next.push({
        id: "reception",
        label: t("game.quickStats.reception"),
        icon: <IconStar size={14} />,
        tone,
        value:
          ratingScore != null
            ? Math.round(ratingScore)
            : `${steamPositivePercent}%`,
        detail:
          ratingScore != null && steamPositivePercent != null
            ? `${steamPositivePercent}% ${t("review.positive")}`
            : ratingScore == null
              ? t("review.positive")
              : undefined,
        hint:
          ratingScore != null
            ? `Rating: ${Math.round(ratingScore)}/100`
            : undefined,
      });
    }

    if (storyHours != null || completionistHours != null) {
      next.push({
        id: "timeToBeat",
        label: t("game.quickStats.timeToBeat"),
        icon: <IconClock size={14} />,
        value: storyHours ?? completionistHours,
        unit: "h",
        detail:
          storyHours != null && completionistHours != null
            ? `${t("game.quickStats.completionist")} ${completionistHours}h`
            : storyHours != null
              ? t("game.quickStats.story")
              : t("game.quickStats.completionist"),
        progress: storyProgressPercent ?? undefined,
        hint:
          storyProgressPercent != null
            ? `${storyProgressPercent}% completed`
            : undefined,
      });
    }

    if (sizeFigure) {
      next.push({
        id: "storage",
        label: t("game.quickStats.storage"),
        icon: <IconHardDrive size={14} />,
        value: sizeFigure.value,
        unit: sizeFigure.unit,
        detail: game.installed ? t("filter.installed") : undefined,
      });
    }

    if (!isStoreMode) {
      const noCost = resolvedCost == null;
      const noRate = valuePerHour == null;
      const valueText = noCost
        ? t("game.quickStats.setCost")
        : noRate
          ? formatCost(resolvedCost.cost, resolvedCost.currency)
          : formatCost(valuePerHour, resolvedCost.currency);
      const valueFigure = noCost ? { value: valueText } : splitFigure(valueText);
      next.push({
        id: "value",
        label: t("game.quickStats.value"),
        icon: <IconTag size={14} />,
        value: valueFigure.value,
        unit: valueFigure.unit,
        detail: noCost || noRate ? undefined : t("game.quickStats.perHour"),
        hint: noCost
          ? t("game.quickStats.setCostHint")
          : noRate
            ? t("game.quickStats.needPlaytime")
            : undefined,
        onClick: noCost ? onSetCost : undefined,
      });
    }

    if (showDeckVerified && effectiveSteamAppId != null) {
      next.push({
        id: "compatibility",
        label: t("game.quickStats.compatibility"),
        icon: <IconShield size={14} />,
        tone: "accent",
        value: t("game.quickStats.deckVerified"),
      });
    }

    if (!isStoreMode) {
      next.push({
        id: "lastPlayed",
        label: t("game.quickStats.lastPlayed"),
        icon: <IconCalendar size={14} />,
        value: lastPlayedRelative,
        detail:
          currentHours > 0
            ? `${currentHours}h ${t("hero.playTime").toLowerCase()}`
            : undefined,
      });
    }

    return next;
  }, [
    ratingScore,
    steamPositivePercent,
    storyHours,
    completionistHours,
    storyProgressPercent,
    formattedSize,
    game.installed,
    resolvedCost,
    valuePerHour,
    isStoreMode,
    showDeckVerified,
    effectiveSteamAppId,
    lastPlayedRelative,
    currentHours,
    onSetCost,
    t,
  ]);

  if (items.length === 0) return null;

  return (
    <StatBand
      items={items}
      ariaLabel={t("game.quickStats.aria")}
      className="game-quick-stats"
    />
  );
}
