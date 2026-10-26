import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Download, Sparkles, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Game, GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";
import { Button } from "../ui";
import { captureAndSaveScreenshot } from "../../utils/screenshot";
import type { ActivityRange } from "../../utils/activity/range";
import { buildActivityRecap } from "../../utils/activity/recap";
import { useFocusProps } from "./focusable";

export interface ActivityRecapModalProps {
  open: boolean;
  onClose: () => void;
  sessions: GameSession[];
  games: Game[];
  range: ActivityRange;
  rangeLabel: string;
}

/**
 * Share-ready period card. Previewed in a centred modal and captured from the
 * card element itself, so the PNG matches what the user sees.
 */
export function ActivityRecapModal({
  open,
  onClose,
  sessions,
  games,
  range,
  rangeLabel,
}: ActivityRecapModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const recap = useMemo(
    () => buildActivityRecap(sessions, games, range),
    [sessions, games, range],
  );

  const save = async () => {
    const element = cardRef.current;
    if (!element) return;
    try {
      const filePath = await captureAndSaveScreenshot({
        element,
        fileName: `gameindex_activity_${range.startDate}_${range.endDate}`,
        title: t("activityWs.recap.title"),
        filterLabel: t("activity.pngImage"),
        backgroundColor: "var(--color-bg-secondary)",
        fallbackBackground: "var(--color-bg-secondary)",
      });
      if (filePath) showToast(t("activityWs.recap.saved"), "success");
    } catch (error) {
      console.error("Recap capture failed:", error);
      showToast(t("activity.screenshotFailed", { error: String(error) }), "error");
    }
  };

  const closeFocus = useFocusProps(onClose);
  const saveFocus = useFocusProps(() => void save());

  // Escape closes, and the page behind the modal stays put while it is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="act-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="act-modal act-modal--recap"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="act-modal__header">
          <div className="act-modal__title-group">
            <div className="act-modal__icon-pill">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="act-modal__title" id={titleId}>
                {t("activityWs.recap.title")}
              </h3>
              <span className="act-modal__sub">{t("activityWs.recap.description")}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            type="button"
            leftIcon={<X size={16} />}
            aria-label={t("common.close")}
            ref={closeFocus.ref}
            tabIndex={closeFocus.tabIndex}
            onClick={closeFocus.onClick}
          />
        </header>

        <div className="act-modal__body activity-recap-modal__body">
          <div className="activity-recap-card" ref={cardRef}>
            <div className="activity-recap-card__glow" aria-hidden="true" />
            <header className="activity-recap-card__head">
              <span className="activity-recap-card__mark">
                <Sparkles size={14} aria-hidden="true" />
                GameIndex
              </span>
              <span className="activity-recap-card__range">{rangeLabel}</span>
            </header>

            <div className="activity-recap-card__hero">
              <span className="activity-recap-card__eyebrow">{t("activityWs.recap.period")}</span>
              <span className="activity-recap-card__value">{formatPlayTime(recap.minutes)}</span>
              <span className="activity-recap-card__sub">
                {t("activityWs.recap.summary", {
                  sessions: recap.sessionCount,
                  games: recap.gameCount,
                })}
              </span>
            </div>

            <div className="activity-recap-card__stats">
              <div>
                <span className="activity-recap-card__stat-label">
                  {t("activityWs.recap.activeDays")}
                </span>
                <span className="activity-recap-card__stat-value">{recap.activeDays}</span>
              </div>
              <div>
                <span className="activity-recap-card__stat-label">
                  {t("activityWs.recap.streak")}
                </span>
                <span className="activity-recap-card__stat-value">{recap.longestStreak}</span>
              </div>
              <div>
                <span className="activity-recap-card__stat-label">
                  {t("activityWs.recap.longestSession")}
                </span>
                <span className="activity-recap-card__stat-value">
                  {formatPlayTime(recap.longestSessionMin)}
                </span>
              </div>
            </div>

            {recap.topGames.length > 0 && (
              <div className="activity-recap-card__top">
                <span className="activity-recap-card__section-label">
                  {t("activityWs.recap.topGames")}
                </span>
                {recap.topGames.map((game, index) => {
                  const max = recap.topGames[0]?.minutes || 1;
                  return (
                    <div key={game.id} className="activity-recap-card__game">
                      <span className="activity-recap-card__rank">{index + 1}</span>
                      <span className="activity-recap-card__game-name">{game.name}</span>
                      <span className="activity-recap-card__game-track" aria-hidden="true">
                        <span
                          className="activity-recap-card__game-fill"
                          style={{ width: `${Math.max(4, (game.minutes / max) * 100)}%` }}
                        />
                      </span>
                      <span className="activity-recap-card__game-time">
                        {formatPlayTime(game.minutes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="activity-recap-card__heat" aria-hidden="true">
              {recap.heatmap.map((cell) => {
                const intensity = cell.minutes > 0 ? Math.min(1, 0.25 + cell.minutes / 180) : 0;
                return (
                  <span
                    key={cell.day}
                    className="activity-recap-card__heat-cell"
                    style={{ opacity: cell.minutes > 0 ? intensity : 0.18 }}
                    title={cell.day}
                  />
                );
              })}
            </div>

            <footer className="activity-recap-card__foot">
              <span>{t("activityWs.recap.footer")}</span>
              <span className="activity-recap-card__foot-mark">GameIndex</span>
            </footer>
          </div>
        </div>

        <div className="act-modal__actions">
          <Button
            variant="primary"
            size="sm"
            type="button"
            leftIcon={<Download size={14} />}
            ref={saveFocus.ref}
            tabIndex={saveFocus.tabIndex}
            onClick={saveFocus.onClick}
          >
            {t("activityWs.recap.save")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ActivityRecapModal;
