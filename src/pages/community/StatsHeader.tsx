import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import html2canvas from "html2canvas";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { prepareClonedDocumentForCanvasCapture, resolveColorForCapture } from "../../utils/color";
import { formatHours } from "./statsCalculations";
import type { GamerLevelInfo, GamerPersona, StreakInfo, TimeframePreset } from "./statsTypes";

interface StatsHeaderProps {
  levelInfo: GamerLevelInfo;
  persona: GamerPersona;
  streak: StreakInfo;
  totalPlaytimeMin: number;
  totalSessions: number;
  totalGames: number;
  timeframe: TimeframePreset;
  onTimeframeChange: (timeframe: TimeframePreset) => void;
  onExportJson: () => void;
}

export function StatsHeader({
  levelInfo,
  persona,
  streak,
  totalPlaytimeMin,
  totalSessions,
  totalGames,
  timeframe,
  onTimeframeChange,
  onExportJson,
}: StatsHeaderProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  // Share profile as formatted markdown
  const handleShareMarkdown = useCallback(async () => {
    const md = [
      `# 🎮 ${t("community.playerProfile")} — ${t(persona.titleKey)}`,
      `**${t("stats.level")} ${levelInfo.level}** (${levelInfo.title}) · **${levelInfo.totalXp.toLocaleString()} XP**`,
      "",
      `⏱️ **${t("community.totalPlaytime")}**: ${formatHours(totalPlaytimeMin)}`,
      `🕹️ **${t("community.sessions")}**: ${totalSessions}`,
      `📚 **${t("community.gamesInLibrary")}**: ${totalGames}`,
      `🔥 **${t("communityExtras.dayStreak")}**: ${streak.current} (${t("communityExtras.longest", { days: streak.longest })})`,
      "",
      `*Generated via GameIndex on ${new Date().toLocaleDateString()}*`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(md);
      showToast(t("community.profileCopied"), "success");
    } catch {
      showToast(t("community.copyFailed"), "error");
    }
  }, [levelInfo, persona, totalPlaytimeMin, totalSessions, totalGames, streak, t, showToast]);

  // Capture full screenshot of the stats container
  const handleCaptureScreenshot = useCallback(async () => {
    try {
      const container = document.querySelector(".stats-page-container");
      if (!container) return;

      const fullWidth = (container as HTMLElement).scrollWidth;
      const fullHeight = (container as HTMLElement).scrollHeight;

      const canvas = await html2canvas(container as HTMLElement, {
        backgroundColor: resolveColorForCapture("var(--color-bg-primary)", "#0f1117"),
        scale: 2,
        logging: false,
        useCORS: true,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        onclone: (clonedDoc) => {
          prepareClonedDocumentForCanvasCapture(clonedDoc);
        },
      });

      const dataUrl = canvas.toDataURL("image/png");
      const filePath = await save({
        title: t("activity.saveScreenshot"),
        defaultPath: `gameindex_stats_${new Date().toISOString().slice(0, 10)}.png`,
        filters: [{ name: t("activity.pngImage"), extensions: ["png"] }],
      });

      if (!filePath) return;

      await invoke("save_screenshot", { filePath, base64Data: dataUrl });
      showToast(t("gameActivity.screenshotSaved"), "success");
    } catch (err) {
      console.error("[Stats] Screenshot failed:", err);
      showToast(t("gameActivity.screenshotFailed", { error: String(err) }), "error");
    }
  }, [t, showToast]);

  return (
    <div className="stats-cockpit-banner">
      <div className="stats-cockpit-left">
        {/* Gamer Persona Avatar / Level Ring */}
        <div className="stats-persona-avatar-wrap">
          <div className="stats-persona-badge" title={t(persona.subtitleKey)}>
            <span className="stats-persona-emoji">{persona.badgeEmoji}</span>
          </div>
          <div className="stats-level-pill">
            <span className="stats-level-text">LVL {levelInfo.level}</span>
          </div>
        </div>

        {/* Player Identity & Level Progress */}
        <div className="stats-identity-info">
          <div className="stats-identity-header">
            <h1 className="stats-player-title">{t(persona.titleKey)}</h1>
            <span className="stats-level-title">{levelInfo.title}</span>
          </div>
          <p className="stats-player-subtitle">{t(persona.subtitleKey)}</p>

          {/* XP Progress Bar */}
          <div className="stats-xp-bar-wrap" title={`${levelInfo.currentXp} / ${levelInfo.xpForNextLevel} XP (${levelInfo.progressPct}%)`}>
            <div className="stats-xp-bar-track">
              <div
                className="stats-xp-bar-fill"
                style={{ width: `${levelInfo.progressPct}%` }}
              />
            </div>
            <div className="stats-xp-labels">
              <span className="stats-xp-current">{levelInfo.currentXp} XP</span>
              <span className="stats-xp-next">{levelInfo.xpForNextLevel} XP</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cockpit Middle: Quick Stat Pills */}
      <div className="stats-cockpit-metrics">
        <div className="stats-metric-card">
          <span className="stats-metric-icon">⏱️</span>
          <div className="stats-metric-content">
            <span className="stats-metric-val">{formatHours(totalPlaytimeMin)}</span>
            <span className="stats-metric-lbl">{t("community.totalPlaytime")}</span>
          </div>
        </div>

        <div className="stats-metric-card">
          <span className="stats-metric-icon">🎮</span>
          <div className="stats-metric-content">
            <span className="stats-metric-val">{totalSessions}</span>
            <span className="stats-metric-lbl">{t("community.sessions")}</span>
          </div>
        </div>

        <div className="stats-metric-card">
          <span className="stats-metric-icon">{streak.current > 0 ? "🔥" : "❄️"}</span>
          <div className="stats-metric-content">
            <span className="stats-metric-val">{streak.current} {t("communityExtras.dayStreak")}</span>
            <span className="stats-metric-lbl">{t("communityExtras.longest", { days: streak.longest })}</span>
          </div>
        </div>
      </div>

      {/* Cockpit Right: Actions & Timeframe Filter */}
      <div className="stats-cockpit-actions">
        <div className="stats-action-buttons">
          <button
            type="button"
            className="stats-action-btn"
            onClick={handleShareMarkdown}
            title={t("community.shareProfile")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span>{t("community.shareProfile")}</span>
          </button>

          <button
            type="button"
            className="stats-action-btn"
            onClick={handleCaptureScreenshot}
            title={t("activity.capture")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span>{t("activity.capture")}</span>
          </button>

          <button
            type="button"
            className="stats-action-btn"
            onClick={onExportJson}
            title={t("stats.exportData")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>JSON</span>
          </button>
        </div>

        {/* Timeframe selector pills */}
        <div className="stats-timeframe-selector" role="group" aria-label={t("stats.timeframeLabel")}>
          {(["all", "year", "90d", "30d"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              className={`stats-timeframe-pill${timeframe === preset ? " active" : ""}`}
              onClick={() => onTimeframeChange(preset)}
            >
              {preset === "all"
                ? t("activity.allTime")
                : preset === "year"
                ? new Date().getFullYear()
                : preset.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
