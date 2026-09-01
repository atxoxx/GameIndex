import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime } from "../../types/game";
import { type CompletionProgress } from "./insights";
import * as Icons from "./Icons";

export function TimeToBeatProgress({
  progress,
  showHeader = true,
}: {
  progress: CompletionProgress;
  showHeader?: boolean;
}) {
  const { t } = useLanguage();

  if (!progress.hasTimeToBeat) {
    return null;
  }

  const getStatusBadge = () => {
    switch (progress.status) {
      case "completionistComplete":
        return {
          label: t("gameActivity.ttb.status100"),
          className: "act-ttb__status-badge act-ttb__status-badge--completionistComplete",
        };
      case "mainStoryComplete":
        return {
          label: t("gameActivity.ttb.statusMainDone"),
          className: "act-ttb__status-badge act-ttb__status-badge--mainStoryComplete",
        };
      case "inProgress":
        return {
          label: t("gameActivity.ttb.statusInProgress"),
          className: "act-ttb__status-badge act-ttb__status-badge--inProgress",
        };
      case "notStarted":
      default:
        return {
          label: t("gameActivity.ttb.statusNotStarted"),
          className: "act-ttb__status-badge act-ttb__status-badge--notStarted",
        };
    }
  };

  const statusBadge = getStatusBadge();

  return (
    <div className={`act-ttb ${showHeader ? "" : "act-ttb--plain"}`}>
      {showHeader && (
        <div className="act-ttb__header">
          <div className="act-ttb__titles">
            <span className="act-ttb__icon" aria-hidden="true">
              <Icons.Target size={15} />
            </span>
            <div>
              <h4 className="act-ttb__title">{t("gameActivity.ttb.title")}</h4>
              <span className="act-ttb__subtitle">{t("gameActivity.ttb.subtitle")}</span>
            </div>
          </div>
          <span className={statusBadge.className}>{statusBadge.label}</span>
        </div>
      )}

      <div className="act-ttb__progress-bars">
        {progress.mainStoryHours && (
          <div className="act-ttb__bar-group">
            <div className="act-ttb__bar-header">
              <span className="act-ttb__bar-label">{t("gameActivity.ttb.mainStory")}</span>
              <span className="act-ttb__bar-val">
                <strong>{formatPlayTime(Math.round(progress.playedMinutes))}</strong> / {progress.mainStoryHours}h ({progress.mainStoryPct}%)
              </span>
            </div>
            <div className="act-ttb__track">
              <div
                className="act-ttb__fill act-ttb__fill--story"
                style={{ width: `${Math.min(100, progress.mainStoryPct)}%` }}
              />
            </div>
          </div>
        )}

        {progress.mainExtraHours && (
          <div className="act-ttb__bar-group">
            <div className="act-ttb__bar-header">
              <span className="act-ttb__bar-label">{t("gameActivity.ttb.mainExtra")}</span>
              <span className="act-ttb__bar-val">
                <strong>{formatPlayTime(Math.round(progress.playedMinutes))}</strong> / {progress.mainExtraHours}h (
                {Math.min(100, Math.round((progress.playedHours / progress.mainExtraHours) * 100))}%)
              </span>
            </div>
            <div className="act-ttb__track">
              <div
                className="act-ttb__fill act-ttb__fill--extra"
                style={{
                  width: `${Math.min(100, Math.round((progress.playedHours / progress.mainExtraHours) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}

        {progress.completionistHours && (
          <div className="act-ttb__bar-group">
            <div className="act-ttb__bar-header">
              <span className="act-ttb__bar-label">{t("gameActivity.ttb.completionist")}</span>
              <span className="act-ttb__bar-val">
                <strong>{formatPlayTime(Math.round(progress.playedMinutes))}</strong> / {progress.completionistHours}h ({progress.completionistPct}%)
              </span>
            </div>
            <div className="act-ttb__track">
              <div
                className="act-ttb__fill act-ttb__fill--100"
                style={{ width: `${Math.min(100, progress.completionistPct)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
