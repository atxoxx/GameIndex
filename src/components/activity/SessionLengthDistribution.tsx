import { formatPlayTime } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { type SessionDurationBucket } from "./insights";

export function SessionLengthDistribution({
  buckets,
  averageMinutes,
  longestMinutes,
  totalSessions,
}: {
  buckets: SessionDurationBucket[];
  averageMinutes: number;
  longestMinutes: number;
  totalSessions: number;
}) {
  const { t } = useLanguage();

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="act-session-dist">
      <div className="act-session-dist__stats">
        <div className="act-session-dist__stat-chip">
          <span className="act-session-dist__stat-label">{t("activity.avgSession")}</span>
          <span className="act-session-dist__stat-val">{formatPlayTime(averageMinutes)}</span>
        </div>
        <div className="act-session-dist__stat-chip">
          <span className="act-session-dist__stat-label">{t("activity.longestSession")}</span>
          <span className="act-session-dist__stat-val">{formatPlayTime(longestMinutes)}</span>
        </div>
        <div className="act-session-dist__stat-chip">
          <span className="act-session-dist__stat-label">{t("activity.sessions")}</span>
          <span className="act-session-dist__stat-val">{totalSessions}</span>
        </div>
      </div>

      <div className="act-session-dist__list">
        {buckets.map((b) => {
          const fillPct = Math.max(2, (b.count / maxCount) * 100);

          return (
            <div key={b.key} className="act-session-dist__row">
              <div className="act-session-dist__identity">
                <span className="act-session-dist__label">{t(b.labelKey)}</span>
              </div>

              <div className="act-session-dist__track">
                <div
                  className="act-session-dist__fill"
                  style={{ width: `${b.count > 0 ? fillPct : 0}%` }}
                />
              </div>

              <div className="act-session-dist__meta">
                <span className="act-session-dist__count">
                  {b.count} <span className="act-session-dist__count-unit">({b.pct}%)</span>
                </span>
                <span className="act-session-dist__time">{formatPlayTime(b.totalMinutes)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
