import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { KpiTile } from "../ui";
import { type Game } from "../../types/game";
import { useGameAccent } from "../../hooks/useGameAccent";
import { useSettings } from "../../context/SettingsContext";
import { applyGameAccentFamily } from "../../utils/color";
import { useAchievements } from "../../context/AchievementContext";
import {
  useSteamGridArt,
  usePrefetchImage,
} from "../../context/SteamGridDbContext";
import PlayerCountBadge from "../PlayerCountBadge";
import GameLaunchActions from "./GameLaunchActions";
import FriendsPlayingStrip from "../hero/FriendsPlayingStrip";
import { IconClock, IconPlatform, IconShield, IconUsers, IconStar } from "./icons";
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
  /** Optional rating score to show in meta row (0-100) */
  rating?: number | null;
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
  accentSrc: accentProp,
  eyebrow,
  steamAppId: steamAppIdProp,
  metaItems,
  actions,
  friends: friendsProp,
  variant: variantProp,
  rating: ratingProp,
}: GameHeroProps) {
  const { t } = useLanguage();

  const isGame = !!game;
  const name = game?.name ?? nameProp ?? "";
  const coverUrl = game?.coverArtUrl ?? coverProp ?? null;
  const bannerUrl = game?.bannerUrl ?? bannerProp ?? null;
  const logoUrl = game?.logoUrl ?? logoProp ?? null;
  const accentSrc = accentProp ?? coverUrl ?? bannerUrl ?? null;
  const steamAppId = steamAppIdProp ?? game?.steamAppId ?? null;
  const rating = ratingProp ?? (game?.igdbRating || game?.criticRating) ?? null;

  const [coverErrored, setCoverErrored] = useState(false);
  const [logoErrored, setLogoErrored] = useState(false);
  const [sgdbPosterFailed, setSgdbPosterFailed] = useState(false);
  const [ambientStep, setAmbientStep] = useState(0);
  const { autoGameAccent, showGameArtBackdrop } = useSettings();
  const gamePalette = useGameAccent(accentSrc || undefined);

  // The poster defaults to the game's own IGDB cover, falling back to the
  // SteamGridDB grid. The animated SteamGridDB hero is the preferred hero
  // background (it animates in the backdrop), else the Steam CDN banner,
  // else the SteamGridDB banner.
  const sgdb = useSteamGridArt(steamAppId);
  const sgdbHeroAnimated = sgdb?.heroAnimatedUrl ?? null;
  const sgdbHeroStatic = sgdb?.heroUrl ?? null;
  const sgdbGridUrl = sgdb?.gridUrl && !sgdbPosterFailed ? sgdb.gridUrl : null;
  // Warm the animated hero so the backdrop plays without a network hitch.
  usePrefetchImage(sgdbHeroAnimated ?? sgdbHeroStatic);

  useEffect(() => {
    setLogoErrored(false);
    setCoverErrored(false);
    setSgdbPosterFailed(false);
  }, [logoUrl, coverUrl, steamAppId, name]);

  useEffect(() => {
    if (!autoGameAccent || !gamePalette) return;
    applyGameAccentFamily(document.documentElement, gamePalette);
  }, [autoGameAccent, gamePalette]);

  // Ambient background ladder — animated SteamGridDB hero leads, then the
  // Steam CDN banner, then the SteamGridDB banner, then the game's own
  // hero/cover as last resorts.
  const steamCdnBanner =
    isGame && steamAppId != null
      ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/library_hero.jpg`
      : null;
  const ambientCandidates = useMemo(
    () =>
      [sgdbHeroAnimated, steamCdnBanner, sgdbHeroStatic, bannerUrl, coverUrl].filter(
        (u): u is string => !!u
      ),
    [sgdbHeroAnimated, steamCdnBanner, sgdbHeroStatic, bannerUrl, coverUrl]
  );
  const ambientSrc =
    ambientStep < ambientCandidates.length ? ambientCandidates[ambientStep] : null;

  useEffect(() => {
    setAmbientStep(0);
  }, [ambientCandidates]);

  // Achievement progress — prefer the multi-source cache (Steam / GOG /
  // Epic / Retro / manual) so non-Steam games surface real progress, then
  // fall back to the legacy Steam-synced array. Library only.
  const { getGameAchievements } = useAchievements();
  const achData = isGame && game ? getGameAchievements(game.id) : null;
  const achievements = game?.steamAchievements;
  const achUnlocked =
    achData?.unlocked ?? achievements?.filter((a) => a.achieved).length ?? 0;
  const achTotal = achData?.total ?? achievements?.length ?? 0;
  const achPercent = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : null;

  const variant = variantProp ?? (isGame ? "cinematic" : "compact");
  const heroClassName = [
    "game-hero",
    `game-hero--${variant}`,
    isGame ? "" : "game-hero--store",
  ]
    .filter(Boolean)
    .join(" ");

  const posterSrc = coverUrl ?? sgdbGridUrl;
  const showPoster = !!posterSrc && !coverErrored;
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
      {rating && (
        <>
          <span className="game-hero-meta-dot" />
          <span className="game-hero-rating-badge" title={t("ratings.title")}>
            <IconStar size={11} className="game-hero-rating-star" />
            <span>{Math.round(rating)}</span>
          </span>
        </>
      )}
    </>
  ) : (
    <>
      {(metaItems ?? []).map((item, i) => (
        <Fragment key={i}>
          <span className="game-hero-meta-item">{item}</span>
          {i < (metaItems?.length ?? 0) - 1 && <span className="game-hero-meta-dot" />}
        </Fragment>
      ))}
      {rating && (
        <>
          {(metaItems?.length ?? 0) > 0 && <span className="game-hero-meta-dot" />}
          <span className="game-hero-rating-badge" title={t("ratings.title")}>
            <IconStar size={11} className="game-hero-rating-star" />
            <span>{Math.round(rating)}</span>
          </span>
        </>
      )}
    </>
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
      style={
        gamePalette
          ? ({
              "--game-accent": gamePalette.primary,
              "--game-accent-2": gamePalette.secondary,
              "--game-accent-deep": gamePalette.deep,
            } as CSSProperties)
          : undefined
      }
    >
      {/* Background art: a blurred copy of the banner/cover with glow */}
      {ambientSrc && showGameArtBackdrop ? (
        <>
          <img
            src={ambientSrc}
            alt=""
            aria-hidden="true"
            style={{ display: "none" }}
            onError={() => setAmbientStep((s) => s + 1)}
          />
          <div
            className="game-hero__bg"
            style={{ backgroundImage: `url(${ambientSrc})` }}
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="game-hero__bg game-hero__bg--fallback" aria-hidden="true" />
      )}
      <div className="game-hero__scrim" aria-hidden="true" />

      <div className="game-hero__inner">
        {/* 2:3 poster on the left with badge */}
        {showPoster && (
          <div className="game-hero__poster" aria-hidden="true">
            <img
              src={posterSrc!}
              alt=""
              className="game-hero__poster-img"
              onError={() => {
                // A failed SteamGridDB poster falls back to the game's own
                // cover; a failed cover hides the poster entirely.
                if (sgdbGridUrl) {
                  setSgdbPosterFailed(true);
                } else {
                  setCoverErrored(true);
                }
              }}
            />
            {isGame && game.installed && (
              <span className="game-hero__poster-badge game-hero__poster-badge--installed">
                {t("filter.installed")}
              </span>
            )}
          </div>
        )}

        {/* Content column */}
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
