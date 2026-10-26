import { useState } from "react";
import { Check, Pencil, Target } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime } from "../../types/game";
import { Button } from "../ui";
import { Popover } from "../ui/Popover";
import type { WeeklyGoalProgress } from "../../utils/activity/weeklyGoal";

export interface ActivityGoalRingProps {
  progress: WeeklyGoalProgress;
  setTarget: (minutes: number) => void;
  clear: () => void;
}

const RADIUS = 25;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Weekly target next to the period figures. Off by default: the empty state
 * is an invitation, not a fake zero-target ring. Once set, the ring encodes
 * progress and the copy says exactly how much time is left.
 */
export function ActivityGoalRing({ progress, setTarget, clear }: ActivityGoalRingProps) {
  const { t } = useLanguage();
  const [hours, setHours] = useState(() =>
    progress.targetMin > 0 ? (progress.targetMin / 60).toFixed(1).replace(/\.0$/, "") : "10",
  );

  const targetMinutes = Math.round((Number(hours) || 0) * 60);
  const dash = (progress.percent / 100) * CIRCUMFERENCE;

  return (
    <Popover
      label={t("activityWs.goal.title")}
      align="end"
      width={280}
      role="dialog"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className={`activity-goal${progress.targetMin > 0 ? "" : " activity-goal--empty"}`}
          aria-label={
            progress.targetMin > 0 ? t("activityWs.goal.edit") : t("activityWs.goal.set")
          }
          onClick={() => {
            setHours(
              progress.targetMin > 0
                ? (progress.targetMin / 60).toFixed(1).replace(/\.0$/, "")
                : "10",
            );
            props.onClick();
          }}
        >
          {progress.targetMin > 0 ? (
            <>
              <span className="activity-goal__ring" aria-hidden="true">
                <svg viewBox="0 0 60 60" width="60" height="60">
                  <circle
                    cx="30"
                    cy="30"
                    r={RADIUS}
                    className="activity-goal__track"
                    fill="none"
                    strokeWidth="5"
                  />
                  <circle
                    cx="30"
                    cy="30"
                    r={RADIUS}
                    className="activity-goal__fill"
                    fill="none"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
                    transform="rotate(-90 30 30)"
                  />
                </svg>
                <span className="activity-goal__percent">
                  {progress.reached ? <Check size={16} /> : `${progress.percent}%`}
                </span>
              </span>
              <span className="activity-goal__copy">
                <span className="activity-goal__label">{t("activityWs.goal.week")}</span>
                <span className="activity-goal__value">
                  {progress.reached
                    ? t("activityWs.goal.reached")
                    : t("activityWs.goal.remaining", {
                        time: formatPlayTime(progress.remainingMin),
                      })}
                </span>
                <span className="activity-goal__hint">
                  {t("activityWs.goal.progress", {
                    minutes: formatPlayTime(progress.minutes),
                    target: formatPlayTime(progress.targetMin),
                  })}
                </span>
              </span>
              <Pencil size={13} className="activity-goal__edit" aria-hidden="true" />
            </>
          ) : (
            <>
              <span className="activity-goal__icon" aria-hidden="true">
                <Target size={18} />
              </span>
              <span className="activity-goal__copy">
                <span className="activity-goal__label">{t("activityWs.goal.title")}</span>
                <span className="activity-goal__value">{t("activityWs.goal.set")}</span>
                <span className="activity-goal__hint">{t("activityWs.goal.offHint")}</span>
              </span>
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="activity-goal__editor">
          <span className="ui-popover__label">{t("activityWs.goal.title")}</span>
          <label className="ui-popover__field">
            {t("activityWs.goal.hours")}
            <input
              type="number"
              min={0.5}
              max={168}
              step={0.5}
              value={hours}
              aria-label={t("activityWs.goal.hours")}
              onChange={(event) => setHours(event.target.value)}
            />
          </label>
          <p className="ui-popover__hint">{t("activityWs.goal.offHint")}</p>
          <div className="ui-popover__actions">
            {progress.targetMin > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clear();
                  close();
                }}
              >
                {t("activityWs.goal.clear")}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={targetMinutes <= 0}
              onClick={() => {
                setTarget(targetMinutes);
                close();
              }}
            >
              {t("activityWs.goal.save")}
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

export default ActivityGoalRing;
