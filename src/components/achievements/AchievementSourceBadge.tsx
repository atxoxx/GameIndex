// AchievementSourceBadge — small per-source tag shared by the
// AchievementsPage rows and the per-game AchievementsTab header.
//
// Colors are fixed brand tints (the same --brand-* tokens the settings
// integration tiles use) applied through `data-source` attribute
// selectors in achievements.css, so every theme keeps identical source
// identity without hardcoded hex in JSX.

import { useLanguage } from "../../context/LanguageContext";
import type { AchievementSource } from "../../types/game";

/** All supported achievement providers, in display order. */
export const ACHIEVEMENT_SOURCES: readonly AchievementSource[] = [
  "steam",
  "retro",
  "manual",
  "gog",
  "epic",
];

/** Resolve a payload's active source, defaulting to steam for legacy data. */
export function sourceOfPayload(
  data: { source?: AchievementSource } | null | undefined,
): AchievementSource {
  return data?.source ?? "steam";
}

export default function AchievementSourceBadge({
  source,
}: {
  source: AchievementSource;
}) {
  const { t } = useLanguage();
  return (
    <span className="ach-source-badge" data-source={source}>
      {t(`achievements.source.${source}`)}
    </span>
  );
}
