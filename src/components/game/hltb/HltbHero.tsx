import { useState, type RefObject } from "react";
import type { HltbStats } from "../../../types/game";
import { parsePlayTime } from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { Badge, Button } from "../../ui";
import {
  IconBuilding,
  IconClock,
  IconPlatform,
  IconTag,
  IconX,
} from "../icons";
import { formatDuration, type StyleRowData } from "./hltbShared";

interface HltbHeroProps {
  stats: HltbStats;
  playTime?: string;
  activeStyle?: StyleRowData;
  styles: StyleRowData[];
  headingId: string;
  onClose?: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

function formatYear(value?: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})/);
  return match ? match[1] : null;
}

/**
 * Cover-tinted summary at the top of the HLTB sheet: identity, credits,
 * play modes and the personal playtime gauge against the pinned playstyle.
 */
export function HltbHero({
  stats,
  playTime,
  activeStyle,
  styles,
  headingId,
  onClose,
  closeButtonRef,
}: HltbHeroProps) {
  const { t } = useLanguage();
  const [artFailed, setArtFailed] = useState(false);
  const art = stats.imageUrl && !artFailed ? stats.imageUrl : null;

  const playSeconds = Math.max(0, parsePlayTime(playTime ?? "")) * 60;
  const target = activeStyle?.stat?.average ?? 0;
  const percent = target > 0 && playSeconds > 0 ? Math.round((playSeconds / target) * 100) : 0;
  const remaining = Math.max(0, target - playSeconds);
  const nextUp =
    playSeconds > 0 && percent >= 100 && activeStyle
      ? [...styles]
          .filter(
            (row) =>
              row.key !== activeStyle.key &&
              row.key !== "all" &&
              (row.stat?.average ?? 0) > playSeconds &&
              (row.stat?.average ?? 0) > (activeStyle.stat?.average ?? 0)
          )
          .sort((a, b) => (a.stat?.average ?? 0) - (b.stat?.average ?? 0))[0]
      : undefined;

  const year = formatYear(
    stats.releaseWorld ?? stats.releaseNa ?? stats.releaseEu ?? stats.releaseJp
  );
  const modeChips = [
    stats.levels?.singlePlayer && t("hltb.singlePlayer"),
    stats.levels?.coOp && t("hltb.coOp"),
    stats.levels?.multiplayer && t("hltb.multiplayer"),
    stats.levels?.combined && t("hltb.combined"),
  ].filter(Boolean) as string[];
  const ratingChips = [stats.ratingEsrb, stats.ratingPegi, stats.ratingCero].filter(
    Boolean
  ) as string[];
  const credits = [...new Set([stats.developer, stats.publisher].filter(Boolean))];

  return (
    <header className="hltb-hero">
      {art && (
        <>
          <div
            className="hltb-hero__backdrop"
            style={{ backgroundImage: `url("${art}")` }}
            aria-hidden="true"
          />
          <div className="hltb-hero__scrim" aria-hidden="true" />
        </>
      )}

      <div className="hltb-hero__content">
        {art && (
          <div className="hltb-hero__poster">
            <img
              src={art}
              alt=""
              loading="lazy"
              onError={() => setArtFailed(true)}
            />
          </div>
        )}

        <div className="hltb-hero__main">
          <div className="hltb-hero__kicker">
            <span className="hltb-hero__source">
              <IconClock size={12} />
              {t("gameInfo.hltb")}
            </span>
            {stats.gameType && (
              <Badge variant="accent">
                {stats.gameType === "dlc" ? t("hltb.dlc") : t("hltb.game")}
              </Badge>
            )}
            {year && <span className="hltb-hero__year">{year}</span>}
          </div>

          <h2 className="hltb-hero__title" id={headingId}>
            {stats.gameName}
          </h2>
          {stats.gameAlias && stats.gameAlias !== stats.gameName && (
            <p className="hltb-hero__alias">{stats.gameAlias}</p>
          )}
          {stats.description && (
            <p className="hltb-hero__tagline">{stats.description}</p>
          )}

          {(credits.length > 0 || stats.genres || stats.platforms) && (
            <div className="hltb-hero__credits">
              {credits.length > 0 && (
                <span title={credits.join(" · ")}>
                  <IconBuilding size={12} />
                  {credits.join(" · ")}
                </span>
              )}
              {stats.genres && (
                <span title={stats.genres}>
                  <IconTag size={12} />
                  {stats.genres}
                </span>
              )}
              {stats.platforms && (
                <span title={stats.platforms}>
                  <IconPlatform size={12} />
                  {stats.platforms}
                </span>
              )}
            </div>
          )}

          {(modeChips.length > 0 || ratingChips.length > 0) && (
            <div className="hltb-hero__chips">
              {modeChips.map((chip) => (
                <Badge variant="info" key={chip}>
                  {chip}
                </Badge>
              ))}
              {ratingChips.map((rating) => (
                <Badge variant="warning" key={rating}>
                  {rating}
                </Badge>
              ))}
            </div>
          )}

          {playSeconds > 0 && activeStyle && target > 0 && (
            <div className="hltb-hero__progress">
              <div className="hltb-hero__progress-head">
                <span>
                  {t("hltb.yourPlaytime")}{" "}
                  <strong>{formatDuration(playSeconds)}</strong>
                </span>
                <span
                  className={`hltb-hero__progress-pct${
                    percent >= 100 ? " hltb-hero__progress-pct--done" : ""
                  }`}
                >
                  {t("hltb.percentOfStyle", {
                    percent,
                    style: activeStyle.label,
                  })}
                </span>
              </div>
              <div className="hltb-hero__progress-track">
                <div
                  className={`hltb-hero__progress-fill${
                    percent >= 100 ? " hltb-hero__progress-fill--done" : ""
                  }`}
                  style={{ width: `${Math.min(100, percent)}%` }}
                />
              </div>
              <div className="hltb-hero__progress-foot">
                <span>
                  {percent >= 100
                    ? t("hltb.targetReached")
                    : t("hltb.toGo", { hours: formatDuration(remaining) })}
                </span>
                {nextUp && (
                  <span>
                    {t("hltb.nextUp", {
                      style: nextUp.label,
                      hours: formatDuration(nextUp.stat?.average),
                    })}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {onClose && (
        <Button
          ref={closeButtonRef}
          className="hltb-hero__close"
          variant="ghost"
          size="sm"
          iconOnly
          leftIcon={<IconX size={18} />}
          onClick={onClose}
          aria-label={t("common.close")}
          type="button"
        />
      )}
    </header>
  );
}

export default HltbHero;
