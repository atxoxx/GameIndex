import { useEffect } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MetacriticScore } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import { IconExternalLink, IconStar, IconUsers } from "./icons";
import "./MetacriticDetailsModal.css";

/**
 * Metacritic details modal.
 *
 * The right-sidebar Ratings card surfaces a single headline score; this
 * modal shows everything Metacritic exposes for the matched game: the
 * critic Metascore, the community user score, both sentiment labels,
 * review tallies and the critic review distribution.
 */

interface MetacriticDetailsModalProps {
  score: MetacriticScore;
  gameName: string;
  onClose: () => void;
}

function scoreTone(value: number | null | undefined, scale: 100 | 10): string {
  if (value == null) return "none";
  const normalized = scale === 10 ? value * 10 : value;
  if (normalized >= 75) return "positive";
  if (normalized >= 50) return "mixed";
  return "negative";
}

function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString();
}

export function MetacriticDetailsContent({
  score,
  gameName,
}: {
  score: MetacriticScore;
  gameName: string;
}) {
  const { t } = useLanguage();

  const hasMetascore = score.metascore != null;
  const hasUserScore = score.userScore != null;

  const criticDistribution = [
    { key: "positive", label: t("ratings.positive"), count: score.positiveCount ?? 0, tone: "positive" },
    { key: "mixed", label: t("ratings.mixed"), count: score.neutralCount ?? 0, tone: "mixed" },
    { key: "negative", label: t("ratings.negative"), count: score.negativeCount ?? 0, tone: "negative" },
  ];
  const userDistribution = [
    { key: "positive", label: t("ratings.positive"), count: score.userPositiveCount ?? 0, tone: "positive" },
    { key: "mixed", label: t("ratings.mixed"), count: score.userNeutralCount ?? 0, tone: "mixed" },
    { key: "negative", label: t("ratings.negative"), count: score.userNegativeCount ?? 0, tone: "negative" },
  ];

  if (!hasMetascore && !hasUserScore) {
    return (
      <div className="mc-details mc-details--empty">
        <IconStar size={22} />
        <p>{t("ratings.metacriticEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="mc-details">
      <p className="mc-details__game">{gameName}</p>

      <div className="mc-scores">
        {hasMetascore && (
          <div className="mc-score-card">
            <span className="mc-score-card__label">{t("ratings.metascore")}</span>
            <div className={`mc-score-badge mc-score-badge--${scoreTone(score.metascore, 100)}`}>
              {score.metascore}
            </div>
            {score.metascoreSentiment && (
              <span className="mc-score-card__sentiment">{score.metascoreSentiment}</span>
            )}
            <span className="mc-score-card__count">
              {score.criticReviewCount != null
                ? t("ratings.basedOnCritics", { count: formatCount(score.criticReviewCount) })
                : "—"}
            </span>
          </div>
        )}

        {hasUserScore && (
          <div className="mc-score-card">
            <span className="mc-score-card__label">
              <IconUsers size={12} /> {t("ratings.userScore")}
            </span>
            <div className={`mc-score-badge mc-score-badge--${scoreTone(score.userScore, 10)}`}>
              {score.userScore}
            </div>
            {score.userScoreSentiment && (
              <span className="mc-score-card__sentiment">{score.userScoreSentiment}</span>
            )}
            <span className="mc-score-card__count">
              {score.userRatingCount != null
                ? t("ratings.basedOnUsers", { count: formatCount(score.userRatingCount) })
                : "—"}
            </span>
          </div>
        )}
      </div>

      <section className="mc-section">
        <h4 className="mc-section__title">
          <IconStar size={14} />
          {t("ratings.scoreBreakdown")}
        </h4>
        <McDistribution label={t("ratings.critics")} rows={criticDistribution} />
        <McDistribution label={t("ratings.userScore")} rows={userDistribution} />
      </section>
    </div>
  );
}

interface DistRow {
  key: string;
  label: string;
  count: number;
  tone: string;
}

/** A single positive/neutral/negative distribution bar with its legend. */
function McDistribution({ label, rows }: { label: string; rows: DistRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total <= 0) return null;
  return (
    <div className="mc-dist-block">
      <span className="mc-dist-block__label">{label}</span>
      <div className="mc-dist">
        <div className="mc-dist__bar">
          {rows.map((row) =>
            row.count > 0 ? (
              <span
                key={row.key}
                className={`mc-dist__seg mc-dist__seg--${row.tone}`}
                style={{ width: `${(row.count / total) * 100}%` }}
                title={`${row.label}: ${row.count}`}
              />
            ) : null,
          )}
        </div>
        <ul className="mc-dist__legend">
          {rows.map((row) => (
            <li key={row.key} className="mc-dist__legend-item">
              <span className={`mc-dist__dot mc-dist__dot--${row.tone}`} />
              <span className="mc-dist__legend-label">{row.label}</span>
              <span className="mc-dist__legend-value">
                {row.count} ({Math.round((row.count / total) * 100)}%)
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function MetacriticDetailsModal({
  score,
  gameName,
  onClose,
}: MetacriticDetailsModalProps) {
  const { t } = useLanguage();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="modal mc-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mc-modal-title"
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <IconStar size={22} />
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="mc-modal-title">
              {t("ratings.metacriticTitle")}
            </h2>
            <p className="modal-subtitle">{t("ratings.metacriticSubtitle")}</p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              width="18"
              height="18"
              aria-hidden
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body mc-modal__body">
          <MetacriticDetailsContent score={score} gameName={gameName} />
        </div>

        <div className="modal-footer">
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            {score.url && (
              <Button
                variant="secondary"
                leftIcon={<IconExternalLink size={14} />}
                onClick={() => {
                  void openUrl(score.url);
                }}
              >
                {t("ratings.viewOnMetacritic")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
