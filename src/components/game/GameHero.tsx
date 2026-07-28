import { Fragment, useState, type CSSProperties } from "react";
import { KpiTile } from "../ui";
import { type Game, PLAY_STATUS_DETAILS } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useGameAccent } from "../../hooks/useGameAccent";
import PlayerCountBadge from "../PlayerCountBadge";
import GameStatusDropdown from "./GameStatusDropdown";
import GameLaunchActions from "./GameLaunchActions";
import HeroTrailer from "../hero/HeroTrailer";
import FriendsPlayingStrip from "../hero/FriendsPlayingStrip";
import { IconClock, IconPlatform, IconShield, IconUsers } from "./icons";
import { useLanguage } from "../../context/LanguageContext";

/**
 * GameHero
 *
 *  Shared, presentational hero used by BOTH the Library game page and the
 *  Store detail page (normal / desktop mode — BigScreen has its own hero).
 *  Unifying the two through this one component keeps the banner, poster,
 *  glass KPI strip and info layout perfectly consistent.
 *
 *  Fixed-height design (see `--hero-h`): the hero is a single rounded card
 *  with a blurred art backdrop (banner / trailer), a crisp 2:3 poster
 *  anchored on the left, and a content column on the right holding the
 *  eyebrow + title/logo, the meta row, the KPI strip and the action cluster.
 *
 *  Two usage modes:
 *   - Library game page: pass `game` (the full Game) — play time, status
 *     dropdown, achievements and the launch cluster are all derived from it.
 *   - Store detail page: pass explicit `name` / `coverUrl` / `bannerUrl` /
 *     `logoUrl` / `steamAppId` / `eyebrow` / `metaItems` / `actions`. The
 *     library-only KPIs simply don't render.
 */

interface GameHeroProps {
  /** Full library game — drives the Library game-page variant. */
  game?: Game;
  /** Launch handler (Library game page). */
  onLaunch?: () => void;

  /* ── Store / explicit overrides ────────────────────────────── */
  name?: string;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  videoUrl?: string | null;
  /** Source image for the per-game accent tint (defaults to cover/banner). */
  accentSrc?: string | null;
  /** Small label above the logo/title (e.g. "GameLib Store"). */
  eyebrow?: React.ReactNode;
  /** Resolved Steam app id for the "Players Now" KPI. */
  steamAppId?: number | null;
  /** Info-row meta fragments (Store). Library derives its own when omitted. */
  metaItems?: React.ReactNode[];
  /** Right-aligned action cluster (Store). Library uses <GameLaunchActions>. */
  actions?: React.ReactNode;
  /** Friends-playing strip target (defaults to the game when present). */
  friends?: { gameName: string; gameId: string } | null;
  /** Banner height profile. Defaults to "cinematic" for Library, "compact" for Store. */
  variant?: "cinematic" | "compact";
}

function formatHeroPlayTime(playTime: string): string {
  if (!playTime) return "0h";
  return playTime;
}

export default function GameHero({
  game,
  onLaunch,
  name: nameProp,
  coverUrl: coverProp,
  bannerUrl: bannerProp,
  logoUrl: logoProp,
  videoUrl: videoProp,
  accentSrc: accentProp,
  eyebrow,
  steamAppId: steamAppIdProp,
  metaItems,
  actions,
  friends: friendsProp,
  variant: variantProp,
}: GameHeroProps) {
  const { updateGame } = useGames();
  const { t } = useLanguage();

  const isGame = !!game;
  const name = game?.name ?? nameProp ?? "";
  const coverUrl = game?.coverArtUrl ?? coverProp ?? null;
  const bannerUrl = game?.bannerUrl ?? bannerProp ?? null;
  const logoUrl = game?.logoUrl ?? logoProp ?? null;
  const videoUrl = game?.videos && game.videos.length ? game.videos[0] : videoProp ?? null;
  const accentSrc = accentProp ?? coverUrl ?? bannerUrl ?? null;
  const steamAppId = steamAppIdProp ?? null;

  const [coverErrored, setCoverErrored] = useState(false);
  const [logoErrored, setLogoErrored] = useState(false);
  const gameAccent = useGameAccent(accentSrc || undefined);

  const addedDate = game
    ? new Date(game.addedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const ambientSrc = bannerUrl || coverUrl || null;

  // Achievement progress (Steam-synced, Library only).
  const achievements = game?.steamAchievements;
  const achUnlocked = achievements?.filter((a) => a.achieved).length ?? 0;
  const achTotal = achievements?.length ?? 0;
  const achPercent = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : null;

  const statusKey = game?.playStatus || "backlog";

  const variant = variantProp ?? (isGame ? "cinematic" : "compact");
  const heroClassName = [
    "game-hero",
    `game-hero--${variant}`,
    isGame ? "" : "game-hero--store",
  ]
    .filter(Boolean)
    .join(" ");

  const showPoster = !!coverUrl && !coverErrored;
  const friends = friendsProp ?? (isGame ? { gameName: game.name, gameId: game.id } : null);

  // ── Info-row meta ────────────────────────────────────────────
  const metaRow = isGame ? (
    <>
      <span className="game-hero-meta-item">
        <IconPlatform size={12} />
        {game!.platform}
      </span>
      <span className="game-hero-meta-dot" />
      <span>{t("hero.playTime")}: {game!.playTime}</span>
      {addedDate && (
        <>
          <span className="game-hero-meta-dot" />
          <span>{t("hero.added")} {addedDate}</span>
        </>
      )}
    </>
  ) : (
    (metaItems ?? []).map((item, i) => (
      <Fragment key={i}>
        <span className="game-hero-meta-item">{item}</span>
        {i < (metaItems?.length ?? 0) - 1 && <span className="game-hero-meta-dot" />}
      </Fragment>
    ))
  );

  // ── KPI strip ────────────────────────────────────────────────
  const kpis = (
    <>
      {steamAppId != null && (
        <KpiTile
          glass
          size="sm"
          label={t("hero.playersNow")}
          icon={<IconUsers size={12} />}
          value={<PlayerCountBadge appId={steamAppId} />}
          intent="accent"
        />
      )}
      {isGame && (
        <KpiTile
          glass
          size="sm"
          label={t("hero.playTime")}
          icon={<IconClock size={12} />}
          value={formatHeroPlayTime(game!.playTime)}
          subtext={game!.installed ? t("filter.installed") : t("game.notInstalled")}
          intent={game!.installed ? "success" : "default"}
        />
      )}
      {isGame && (
        <KpiTile
          glass
          size="sm"
          label={t("hero.status")}
          icon={
            <span
              className="status-dot"
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: PLAY_STATUS_DETAILS[statusKey].color,
                boxShadow: `0 0 6px ${PLAY_STATUS_DETAILS[statusKey].color}`,
              }}
            />
          }
          value={
            <span className="game-hero__status-value">
              {t(PLAY_STATUS_DETAILS[statusKey].labelKey)}
            </span>
          }
          trailing={
            <GameStatusDropdown
              game={game!}
              onChange={(status) => updateGame(game!.id, { playStatus: status })}
            />
          }
          intent={
            statusKey === "playing"
              ? "success"
              : statusKey === "completed"
                ? "info"
                : statusKey === "on_hold"
                  ? "warning"
                  : statusKey === "abandoned"
                    ? "danger"
                    : "default"
          }
        />
      )}
      {achPercent != null && (
        <KpiTile
          glass
          size="sm"
          label={t("nav.achievements")}
          icon={<IconShield size={12} />}
          value={`${achPercent}%`}
          subtext={`${achUnlocked}/${achTotal}`}
          intent={achPercent >= 100 ? "success" : "default"}
        />
      )}
    </>
  );

  return (
    <div
      className={heroClassName}
      style={gameAccent ? ({ "--game-accent": gameAccent } as CSSProperties) : undefined}
    >
      {/* Background art: trailer (when available), else a blurred copy of the
          banner/cover that tints the whole hero with the game's palette. A
          legibility scrim sits on top so the poster + content stay readable. */}
      {videoUrl ? (
        <HeroTrailer
          className="game-hero__media"
          src={videoUrl}
          poster={bannerUrl || coverUrl || undefined}
        />
      ) : ambientSrc ? (
        <div
          className="game-hero__bg"
          style={{ backgroundImage: `url(${ambientSrc})` }}
          aria-hidden="true"
        />
      ) : (
        <div className="game-hero__bg game-hero__bg--fallback" aria-hidden="true" />
      )}
      <div className="game-hero__scrim" aria-hidden="true" />

      <div className="game-hero__inner">
        {/* Crisp 2:3 poster on the left — the canonical detail-page look. */}
        {showPoster && (
          <div className="game-hero__poster" aria-hidden="true">
            <img
              src={coverUrl!}
              alt=""
              className="game-hero__poster-img"
              onError={() => setCoverErrored(true)}
            />
          </div>
        )}

        {/* Content column: head (eyebrow + title + meta) pinned to the top,
            footer (KPI strip + actions) pinned to the bottom. */}
        <div className="game-hero__content">
          <div className="game-hero__head">
            {eyebrow && <span className="game-hero__eyebrow">{eyebrow}</span>}
            {logoUrl && !logoErrored ? (
              <img
                src={logoUrl}
                alt={name}
                className="game-hero-logo"
                onError={() => setLogoErrored(true)}
              />
            ) : (
              <h1 className="game-hero-title">{name}</h1>
            )}
            <div className="game-hero-meta">{metaRow}</div>
            {friends && (
              <FriendsPlayingStrip gameName={friends.gameName} gameId={friends.gameId} />
            )}
          </div>

          <div className="game-hero__footer">
            <div className="game-hero__kpis">{kpis}</div>
            <div className="game-hero__actions">
              {actions ??
                (isGame ? <GameLaunchActions game={game!} onLaunch={onLaunch!} size="sm" /> : null)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
