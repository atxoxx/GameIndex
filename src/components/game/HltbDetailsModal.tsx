import { useEffect } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { HltbStats, HltbTimeStat } from "../../types/game";
import { parsePlayTime } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import { IconClock, IconExternalLink, IconStar, IconUsers } from "./icons";
import "./HltbDetailsModal.css";

/**
 * HowLongToBeat details modal.
 *
 * The right-sidebar card only surfaces the headline times; this modal
 * renders everything HLTB exposes for the matched game: per-style
 * average / median / fastest / slowest with submission counts,
 * speedruns, community tallies, the review histogram, per-platform
 * breakdowns, DLC relations, age ratings and release dates.
 */

interface HltbDetailsModalProps {
  stats: HltbStats;
  playTime?: string;
  onClose: () => void;
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (hours < 10) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(hours)}h`;
}

function formatCount(value?: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString();
}

interface StyleRow {
  key: string;
  label: string;
  stat?: HltbTimeStat;
}

export function HltbDetailsContent({
  stats,
  playTime,
}: {
  stats: HltbStats;
  playTime?: string;
}) {
  const { t } = useLanguage();
  const community = stats.community ?? {};
  const levels = stats.levels ?? {};

  const styleRows: StyleRow[] = [
    { key: "main", label: t("gameInfo.mainStory"), stat: stats.mainStory },
    { key: "plus", label: t("gameInfo.mainExtra"), stat: stats.mainExtra },
    { key: "hundred", label: t("gameInfo.completionist"), stat: stats.completionist },
    { key: "all", label: t("hltb.allStyles"), stat: stats.allStyles },
  ].filter((row) => row.stat && row.stat.average);

  const speedRows: StyleRow[] = [
    { key: "speed", label: t("hltb.speedrun"), stat: stats.speedrun },
    { key: "speed100", label: t("hltb.speedrun100"), stat: stats.completionistSpeedrun },
  ].filter((row) => row.stat && row.stat.count);

  const communityTiles = [
    { key: "playing", label: t("hltb.playing"), value: community.playing },
    { key: "backlog", label: t("hltb.backlog"), value: community.backlog },
    { key: "completed", label: t("hltb.completed"), value: community.completed },
    { key: "replays", label: t("hltb.replays"), value: community.replays },
    { key: "retired", label: t("hltb.retired"), value: community.retired },
    { key: "reviews", label: t("hltb.reviews"), value: community.reviews },
    { key: "total", label: t("hltb.totalLogged"), value: community.total },
  ].filter((tile) => tile.value != null);

  const platforms = stats.platformStats ?? [];
  const related = stats.related ?? [];

  const playMinutes = playTime ? parsePlayTime(playTime) : 0;
  const playHours = playMinutes / 60;
  const mainHours = stats.mainStory?.average ? stats.mainStory.average / 3600 : 0;
  const progressPercent =
    mainHours > 0 ? Math.min(100, Math.round((playHours / mainHours) * 100)) : null;

  const ageRatings = [stats.ratingEsrb, stats.ratingPegi, stats.ratingCero].filter(Boolean);
  const modeChips = [
    levels.singlePlayer && t("hltb.singlePlayer"),
    levels.coOp && t("hltb.coOp"),
    levels.multiplayer && t("hltb.multiplayer"),
    levels.combined && t("hltb.combined"),
  ].filter(Boolean) as string[];

  const hasBreakdown = styleRows.some(
    (row) => row.stat?.median || row.stat?.low || row.stat?.high || row.stat?.count
  );

  return (
    <div className="hltb-details">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="hltb-hero">
        {stats.imageUrl && (
          <div className="hltb-hero__art">
            <img src={stats.imageUrl} alt="" loading="lazy" />
          </div>
        )}
        <div className="hltb-hero__info">
          <div className="hltb-hero__title-row">
            <h3 className="hltb-hero__name">{stats.gameName}</h3>
            {stats.gameType && (
              <span className="hltb-chip hltb-chip--type">
                {stats.gameType === "dlc" ? t("hltb.dlc") : t("hltb.game")}
              </span>
            )}
            {stats.releaseWorld && (
              <span className="hltb-chip">{stats.releaseWorld.slice(0, 4)}</span>
            )}
          </div>
          {stats.gameAlias && <p className="hltb-hero__alias">{stats.gameAlias}</p>}

          <div className="hltb-hero__chips">
            {modeChips.map((chip) => (
              <span className="hltb-chip hltb-chip--mode" key={chip}>
                {chip}
              </span>
            ))}
            {ageRatings.map((rating) => (
              <span className="hltb-chip hltb-chip--rating" key={rating}>
                {rating}
              </span>
            ))}
          </div>

          {progressPercent != null && (
            <div className="hltb-hero__progress">
              <div className="hltb-hero__progress-head">
                <span>
                  {t("hltb.yourPlaytime")}: {formatDuration(playMinutes * 60)}
                </span>
                <span>{t("hltb.progressToMain", { percent: progressPercent })}</span>
              </div>
              <div className="hltb-hero__progress-track">
                <div
                  className="hltb-hero__progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Headline play styles ─────────────────────────────── */}
      {styleRows.length > 0 && (
        <section className="hltb-section">
          <h4 className="hltb-section__title">
            <IconClock size={14} />
            {t("hltb.playStyles")}
          </h4>
          <div className="hltb-times-grid">
            {styleRows.map((row) => (
              <div className="hltb-time-tile" key={row.key}>
                <span className="hltb-time-tile__label">{row.label}</span>
                <span className="hltb-time-tile__value">
                  {formatDuration(row.stat?.average)}
                </span>
                {row.stat?.count != null && (
                  <span className="hltb-time-tile__count">
                    {t("hltb.submissions", { count: formatCount(row.stat.count) })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Detailed breakdown ───────────────────────────────── */}
      {hasBreakdown && (
        <section className="hltb-section">
          <h4 className="hltb-section__title">
            <IconStar size={14} />
            {t("hltb.breakdown")}
          </h4>
          <div className="hltb-table-wrap">
            <table className="hltb-table">
              <thead>
                <tr>
                  <th>{t("hltb.style")}</th>
                  <th>{t("hltb.average")}</th>
                  <th>{t("hltb.median")}</th>
                  <th>{t("hltb.fastest")}</th>
                  <th>{t("hltb.slowest")}</th>
                  <th>{t("hltb.submissionsShort")}</th>
                </tr>
              </thead>
              <tbody>
                {styleRows.map((row) => (
                  <tr key={row.key}>
                    <td className="hltb-table__style">{row.label}</td>
                    <td>{formatDuration(row.stat?.average)}</td>
                    <td>{formatDuration(row.stat?.median)}</td>
                    <td>{formatDuration(row.stat?.low)}</td>
                    <td>{formatDuration(row.stat?.high)}</td>
                    <td>{formatCount(row.stat?.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Speedruns ────────────────────────────────────────── */}
      {speedRows.length > 0 && (
        <section className="hltb-section">
          <h4 className="hltb-section__title">
            <IconClock size={14} />
            {t("hltb.speedruns")}
          </h4>
          <div className="hltb-times-grid hltb-times-grid--two">
            {speedRows.map((row) => (
              <div className="hltb-time-tile" key={row.key}>
                <span className="hltb-time-tile__label">{row.label}</span>
                <span className="hltb-time-tile__value">
                  {formatDuration(row.stat?.average)}
                </span>
                <span className="hltb-time-tile__count">
                  {t("hltb.rangeValue", {
                    low: formatDuration(row.stat?.low),
                    high: formatDuration(row.stat?.high),
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Community tallies ────────────────────────────────── */}
      {communityTiles.length > 0 && (
        <section className="hltb-section">
          <h4 className="hltb-section__title">
            <IconUsers size={14} />
            {t("hltb.community")}
          </h4>
          <div className="hltb-community-grid">
            {communityTiles.map((tile) => (
              <div className="hltb-community-tile" key={tile.key}>
                <span className="hltb-community-tile__value">{formatCount(tile.value)}</span>
                <span className="hltb-community-tile__label">{tile.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Per-platform breakdown ───────────────────────────── */}
      {platforms.length > 0 && (
        <section className="hltb-section">
          <h4 className="hltb-section__title">
            <IconUsers size={14} />
            {t("hltb.byPlatform")}
          </h4>
          <div className="hltb-table-wrap">
            <table className="hltb-table">
              <thead>
                <tr>
                  <th>{t("hltb.platform")}</th>
                  <th>{t("gameInfo.mainStory")}</th>
                  <th>{t("gameInfo.mainExtra")}</th>
                  <th>{t("gameInfo.completionist")}</th>
                  <th>{t("hltb.allStyles")}</th>
                  <th>{t("hltb.completed")}</th>
                </tr>
              </thead>
              <tbody>
                {platforms.map((platform) => (
                  <tr key={platform.platform}>
                    <td className="hltb-table__style">{platform.platform}</td>
                    <td>{formatDuration(platform.mainStory)}</td>
                    <td>{formatDuration(platform.mainExtra)}</td>
                    <td>{formatDuration(platform.completionist)}</td>
                    <td>{formatDuration(platform.allStyles)}</td>
                    <td>{formatCount(platform.completed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── DLC & related ────────────────────────────────────── */}
      {related.length > 0 && (
        <section className="hltb-section">
          <h4 className="hltb-section__title">
            <IconStar size={14} />
            {t("hltb.related")}
          </h4>
          <ul className="hltb-related-list">
            {related.map((item) => (
              <li className="hltb-related-item" key={item.gameId}>
                <span className="hltb-related-item__name">{item.gameName}</span>
                <span className="hltb-related-item__type">
                  {item.gameType === "dlc" ? t("hltb.dlc") : t("hltb.game")}
                </span>
                <span className="hltb-related-item__time">
                  {formatDuration(item.mainStory)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function HltbDetailsModal({
  stats,
  playTime,
  onClose,
}: HltbDetailsModalProps) {
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
        className="modal hltb-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hltb-modal-title"
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <IconClock size={22} />
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="hltb-modal-title">
              {t("gameInfo.hltbTitle")}
            </h2>
            <p className="modal-subtitle">
              {t("hltb.sourceBy", { name: stats.gameName })}
            </p>
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

        <div className="modal-body hltb-modal__body">
          <HltbDetailsContent stats={stats} playTime={playTime} />
        </div>

        <div className="modal-footer">
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            {stats.url && (
              <Button
                variant="secondary"
                leftIcon={<IconExternalLink size={14} />}
                onClick={() => {
                  void openUrl(stats.url as string);
                }}
              >
                {t("hltb.openOnHltb")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
