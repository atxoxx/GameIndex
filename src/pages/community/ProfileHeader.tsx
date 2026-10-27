import { useCallback } from "react";
import { Camera, Clock, Download, Flame, Gamepad2, Library, Share2, Snowflake, Trophy } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button, PageHeader, StatBand } from "../../components/ui";
import { captureAndSaveScreenshot } from "../../utils/screenshot";
import { formatHours } from "./statsCalculations";
import { PersonaIcon } from "./statsIcons";
import type { ProfileTotals } from "./useProfileController";
import type {
  GamerLevelInfo,
  GamerPersona,
  StreakInfo,
  TimeframePreset,
} from "./statsTypes";

interface ProfileHeaderProps {
  levelInfo: GamerLevelInfo;
  persona: GamerPersona;
  streak: StreakInfo;
  totals: ProfileTotals;
  genreBreakdown: { genre: string; minutes: number }[];
  range: TimeframePreset;
  onRangeChange: (range: TimeframePreset) => void;
  hideAchievementProgress: boolean;
}

const RANGE_PRESETS: TimeframePreset[] = ["all", "year", "90d", "30d"];

function rangeLabel(range: TimeframePreset, t: (key: string) => string): string {
  if (range === "all") return t("activity.allTime");
  if (range === "year") return String(new Date().getFullYear());
  return range;
}

/**
 * The profile's identity band: who the player is (level, persona, streak)
 * followed by the figures every tab shares.
 *
 * Built from the same PageHeader + StatBand pair as Activity and Storage so
 * the page sits in the app rather than beside it. The only bespoke part is
 * the level chip on the persona glyph and the XP track underneath.
 */
export function ProfileHeader({
  levelInfo,
  persona,
  streak,
  totals,
  genreBreakdown,
  range,
  onRangeChange,
  hideAchievementProgress,
}: ProfileHeaderProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const handleShareProfile = useCallback(async () => {
    const markdown = [
      `# 🎮 ${t("profile.title")} — ${t(persona.titleKey)}`,
      `**${t("stats.level")} ${levelInfo.level}** (${levelInfo.title}) · **${levelInfo.totalXp.toLocaleString()} XP**`,
      "",
      `⏱️ **${t("community.totalPlaytime")}**: ${formatHours(totals.playtimeMin)}`,
      `🕹️ **${t("community.sessions")}**: ${totals.sessionCount}`,
      `📚 **${t("community.gamesInLibrary")}**: ${totals.libraryCount}`,
      `🔥 **${t("communityExtras.dayStreak")}**: ${streak.current} (${t("communityExtras.longest", { days: streak.longest })})`,
      "",
      `*GameIndex · ${new Date().toLocaleDateString()}*`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(markdown);
      showToast(t("community.profileCopied"), "success");
    } catch {
      showToast(t("community.copyFailed"), "error");
    }
  }, [levelInfo, persona, streak, totals, t, showToast]);

  const handleCapture = useCallback(async () => {
    const container = document.querySelector<HTMLElement>(".profile-page");
    if (!container) return;
    try {
      const filePath = await captureAndSaveScreenshot({
        element: container,
        fileName: "gameindex_profile",
        title: t("activity.saveScreenshot"),
        filterLabel: t("activity.pngImage"),
      });
      if (filePath) showToast(t("gameActivity.screenshotSaved"), "success");
    } catch (error) {
      console.error("[Profile] Screenshot failed:", error);
      showToast(t("gameActivity.screenshotFailed", { error: String(error) }), "error");
    }
  }, [t, showToast]);

  const handleExportJson = useCallback(() => {
    const report = {
      exportedAt: new Date().toISOString(),
      range,
      persona: {
        id: persona.id,
        level: levelInfo.level,
        title: levelInfo.title,
        totalXp: levelInfo.totalXp,
      },
      summary: {
        playtimeMinutes: totals.playtimeMin,
        sessions: totals.sessionCount,
        gamesInLibrary: totals.libraryCount,
        gamesPlayed: totals.playedGames,
        achievementsUnlocked: totals.achievementUnlocked,
        achievementsTotal: totals.achievementTotal,
        currentStreak: streak.current,
        longestStreak: streak.longest,
      },
      genres: genreBreakdown,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gameindex_profile_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showToast(t("stats.exportSuccess") || "Report exported as JSON", "success");
  }, [range, persona, levelInfo, totals, streak, genreBreakdown, showToast, t]);

  const streakText = `${streak.current} ${t("communityExtras.dayStreak")}`;

  return (
    <div className="profile-header">
      <PageHeader
        eyebrow={t("profile.eyebrow")}
        title={t("profile.title")}
        icon={
          <span className="profile-avatar" title={t(persona.subtitleKey)}>
            <PersonaIcon persona={persona} size={22} />
            <span className="profile-avatar__level">
              {t("stats.level")} {levelInfo.level}
            </span>
          </span>
        }
        description={
          <span className="profile-header__identity">
            <span>{t(persona.titleKey)}</span>
            <span className="profile-header__sep" aria-hidden="true">·</span>
            <span>{t(persona.subtitleKey)}</span>
            <span className={`profile-streak${streak.playedToday ? " is-hot" : ""}`}>
              {streak.current > 0 ? <Flame size={12} aria-hidden="true" /> : <Snowflake size={12} aria-hidden="true" />}
              {streakText}
            </span>
          </span>
        }
        actions={
          <div className="profile-header__actions">
            <div className="profile-range" role="group" aria-label={t("stats.timeframeLabel")}>
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`profile-range__pill${range === preset ? " is-active" : ""}`}
                  aria-pressed={range === preset}
                  onClick={() => onRangeChange(preset)}
                >
                  {rangeLabel(preset, t)}
                </button>
              ))}
            </div>

            <div className="profile-header__tools">
              <Button
                variant="tertiary"
                size="md"
                iconOnly
                type="button"
                leftIcon={<Share2 size={15} />}
                title={t("community.shareProfile")}
                aria-label={t("community.shareProfile")}
                onClick={handleShareProfile}
              >
                <span className="sr-only">{t("community.shareProfile")}</span>
              </Button>
              <Button
                variant="tertiary"
                size="md"
                iconOnly
                type="button"
                leftIcon={<Camera size={15} />}
                title={t("activity.capture")}
                aria-label={t("activity.capture")}
                onClick={handleCapture}
              >
                <span className="sr-only">{t("activity.capture")}</span>
              </Button>
              <Button
                variant="tertiary"
                size="md"
                iconOnly
                type="button"
                leftIcon={<Download size={15} />}
                title={t("stats.exportData")}
                aria-label={t("stats.exportData")}
                onClick={handleExportJson}
              >
                <span className="sr-only">{t("stats.exportData")}</span>
              </Button>
            </div>
          </div>
        }
      />

      <div className="profile-xp" title={`${levelInfo.currentXp} / ${levelInfo.xpForNextLevel} XP`}>
        <div className="profile-xp__top">
          <span>
            {t("stats.level")} {levelInfo.level} <span className="profile-xp__title">{levelInfo.title}</span>
          </span>
          <span className="profile-xp__figures">
            {levelInfo.currentXp.toLocaleString()} / {levelInfo.xpForNextLevel.toLocaleString()} XP
          </span>
        </div>
        <div
          className="profile-xp__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={levelInfo.progressPct}
        >
          <span className="profile-xp__fill" style={{ width: `${levelInfo.progressPct}%` }} />
        </div>
      </div>

      <StatBand
        ariaLabel={t("profile.title")}
        className="profile-statband"
        items={[
          {
            id: "playtime",
            label: t("community.totalPlaytime"),
            value: formatHours(totals.playtimeMin),
            detail: rangeLabel(range, t),
            icon: <Clock size={13} aria-hidden="true" />,
            tone: "accent",
          },
          {
            id: "sessions",
            label: t("community.sessions"),
            value: totals.sessionCount,
            icon: <Gamepad2 size={13} aria-hidden="true" />,
          },
          {
            id: "library",
            label: t("community.gamesInLibrary"),
            value: totals.libraryCount,
            icon: <Library size={13} aria-hidden="true" />,
          },
          {
            id: "played",
            label: t("community.gamesPlayed"),
            value: totals.playedGames,
            icon: <Gamepad2 size={13} aria-hidden="true" />,
            tone: "info",
          },
          ...(hideAchievementProgress || totals.achievementPct === null
            ? []
            : [
                {
                  id: "achievements",
                  label: t("community.achievements"),
                  value: `${totals.achievementPct}%`,
                  detail: t("community.unlockedOf", {
                    unlocked: totals.achievementUnlocked,
                    total: totals.achievementTotal,
                  }),
                  icon: <Trophy size={13} aria-hidden="true" />,
                  tone: totals.achievementPct >= 50 ? ("success" as const) : ("warning" as const),
                },
              ]),
        ]}
      />
    </div>
  );
}
