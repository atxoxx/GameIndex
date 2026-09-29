import { formatPlayTime } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { type SessionDurationBucket } from "./insights";
import * as Icons from "./Icons";

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

  const getBucketIcon = (key: string) => {
    switch (key) {
      case "quick":
        return <Icons.Zap size={14} style={{ color: "var(--color-warning)" }} />;
      case "short":
        return <Icons.Coffee size={14} style={{ color: "var(--color-info)" }} />;
      case "medium":
        return <Icons.Play size={14} style={{ color: "var(--color-accent)" }} />;
      case "long":
        return <Icons.Target size={14} style={{ color: "var(--color-brand-blue, var(--color-info))" }} />;
      case "marathon":
        return <Icons.Trophy size={14} style={{ color: "var(--color-success)" }} />;
      default:
        return <Icons.Clock size={14} />;
    }
  };

  return (
    <div className="act-session-dist">
      <div className="act-session-dist__stats">
        <div className="act-session-dist__stat-chip">
          <div className="act-session-dist__stat-icon-wrap">
            <Icons.Clock size={16} />
          </div>
          <div className="act-session-dist__stat-info">
            <span className="act-session-dist__stat-label">{t("activity.avgSession")}</span>
            <span className="act-session-dist__stat-val">{formatPlayTime(averageMinutes)}</span>
          </div>
        </div>
        <div className="act-session-dist__stat-chip">
          <div className="act-session-dist__stat-icon-wrap act-session-dist__stat-icon-wrap--trophy">
            <Icons.Trophy size={16} />
          </div>
          <div className="act-session-dist__stat-info">
            <span className="act-session-dist__stat-label">{t("activity.longestSession")}</span>
            <span className="act-session-dist__stat-val">{formatPlayTime(longestMinutes)}</span>
          </div>
        </div>
        <div className="act-session-dist__stat-chip">
          <div className="act-session-dist__stat-icon-wrap act-session-dist__stat-icon-wrap--cal">
            <Icons.Calendar size={16} />
          </div>
          <div className="act-session-dist__stat-info">
            <span className="act-session-dist__stat-label">{t("activity.sessions")}</span>
            <span className="act-session-dist__stat-val">{totalSessions}</span>
          </div>
        </div>
      </div>

      <div className="act-session-dist__list">
        {buckets.map((b) => {
          const fillPct = Math.max(3, (b.count / maxCount) * 100);

          return (
            <div key={b.key} className={`act-session-dist__row act-session-dist__row--${b.key}`}>
              <div className="act-session-dist__identity">
                <span className={`act-session-dist__icon act-session-dist__icon--${b.key}`}>
                  {getBucketIcon(b.key)}
                </span>
                <span className="act-session-dist__label">{t(b.labelKey)}</span>
              </div>

              <div className="act-session-dist__track">
                <div
                  className={`act-session-dist__fill act-session-dist__fill--${b.key}`}
                  style={{ width: `${b.count > 0 ? fillPct : 0}%` }}
                />
              </div>

              <div className="act-session-dist__meta">
                <span className="act-session-dist__count">
                  <strong>{b.count}</strong> <span className="act-session-dist__count-unit">({b.pct}%)</span>
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
