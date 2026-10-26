import { formatPlayTime } from "../../types/game";
import type { ActivityRecapData } from "./recap";

export interface SummaryLabels {
  title: string;
  sessions: string;
  games: string;
  topGames: string;
  footer: string;
  /** Already interpolated, e.g. "5-day streak". */
  streakText: string;
  /** Already interpolated, e.g. "12 active days". */
  activeDaysText: string;
}

/**
 * Markdown summary for the "Copy summary" action. Kept pure so the copy text
 * can be asserted without mounting the page.
 */
export function buildActivitySummaryText(options: {
  rangeLabel: string;
  recap: ActivityRecapData;
  labels: SummaryLabels;
}): string {
  const { rangeLabel, recap, labels } = options;
  const top = recap.topGames
    .map((game) => `${game.name} (${formatPlayTime(game.minutes)})`)
    .join(", ");
  const lines = [
    `# ${labels.title} — ${rangeLabel}`,
    "",
    `**${formatPlayTime(recap.minutes)}** · ${recap.sessionCount} ${labels.sessions} · ${recap.gameCount} ${labels.games}`,
    `${labels.streakText} · ${labels.activeDaysText}`,
  ];
  if (top) lines.push(`${labels.topGames}: ${top}`);
  lines.push("", labels.footer);
  return lines.join("\n");
}
