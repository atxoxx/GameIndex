import type { HltbStats, HltbTimeStat } from "../../../types/game";

/** Translator shape shared by the HLTB sections. */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

export type StyleKey = "main" | "plus" | "hundred" | "all";
export type TabId = "times" | "community" | "platforms" | "related";

export interface StyleRowData {
  key: StyleKey;
  label: string;
  stat?: HltbTimeStat;
}

export interface SpecialRowData {
  key: string;
  label: string;
  stat?: HltbTimeStat;
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (hours < 10) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(hours)}h`;
}

export function formatCount(value?: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString();
}

export function buildStyleRows(stats: HltbStats, t: Translate): StyleRowData[] {
  return [
    { key: "main", label: t("gameInfo.mainStory"), stat: stats.mainStory },
    { key: "plus", label: t("gameInfo.mainExtra"), stat: stats.mainExtra },
    { key: "hundred", label: t("gameInfo.completionist"), stat: stats.completionist },
    { key: "all", label: t("hltb.allStyles"), stat: stats.allStyles },
  ].filter((row) => Boolean(row.stat && row.stat.average)) as StyleRowData[];
}

export function buildSpeedRows(stats: HltbStats, t: Translate): SpecialRowData[] {
  return [
    { key: "speed", label: t("hltb.speedrun"), stat: stats.speedrun },
    { key: "speed100", label: t("hltb.speedrun100"), stat: stats.completionistSpeedrun },
  ].filter((row) => Boolean(row.stat && row.stat.average)) as SpecialRowData[];
}

export function buildInvestedRows(stats: HltbStats, t: Translate): SpecialRowData[] {
  return [
    { key: "co", label: t("hltb.coopCampaign"), stat: stats.investedCo },
    { key: "mp", label: t("hltb.multiplayerTime"), stat: stats.investedMp },
  ].filter((row) => Boolean(row.stat && row.stat.average)) as SpecialRowData[];
}
