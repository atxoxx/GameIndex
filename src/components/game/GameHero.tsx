import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { KpiTile } from "../ui";
import PageWidget from "../PageWidget";
import { gameDisplayName, type Game } from "../../types/game";
import { useGameAccent } from "../../hooks/useGameAccent";
import { useSettings, useHeroElementLayout, useHeroGridLayout, useAnimatedMediaEnabled } from "../../context/SettingsContext";
import { applyGameAccentFamily } from "../../utils/color";
import { useAchievements } from "../../context/AchievementContext";
import { useToast } from "../../context/ToastContext";
import { HERO_ELEMENTS, type HeroElementKey } from "../../context/interfaceLayout";
import {
  HERO_GRID_ITEM_KEYS,
  sortHeroGridItems,
  type HeroGridItemKey,
} from "../../context/heroGrid";
import {
  useSteamGridArt,
  usePrefetchImage,
} from "../../context/SteamGridDbContext";
import { resolveSteamAppId } from "../../hooks/useGameCardArt";
import PlayerCountBadge from "../PlayerCountBadge";
import GameLaunchActions from "./GameLaunchActions";
import FriendsPlayingStrip from "../hero/FriendsPlayingStrip";
import {
  IconClock,
  IconPlatform,
  IconShield,
  IconUsers,
  IconStar,
  IconTag,
  IconMaximize,
  IconCopy,
  IconChevronLeft,
  IconChevronRight,
  IconImage,
} from "./icons";
import ImageLightbox from "./ImageLightbox";
import { useLanguage } from "../../context/LanguageContext";
import { useTheme } from "../../context/ThemeContext";
import { usePublishGameArtwork } from "../../utils/activeGameArtwork";

/**
 * GameHero
 *
 *  Shared, presentational hero used by BOTH the Library game page and the
 *  Store detail page (normal / desktop mode — BigScreen has its own hero).
 *  Unifying the two through this one component keeps the banner, poster,
 *  glass KPI strip and info layout perfectly consistent.
 *
 *  The hero is a single rounded card with a blurred art backdrop (banner /
 *  trailer), a crisp 2:3 poster docked left (or right), and a content column
 *  holding the eyebrow + title/logo, the meta row, the genre chips + friends
 *  strip, and the KPI strip + action cluster.
 *
 *  Settings → Interface can hide and reorder the elements per scope (`game`
 *  for the Library page, `store` for the Store detail page). The persisted
 *  order is applied with CSS `order` on a stable wrapper per element, so the
 *  layout is content-driven: hiding elements collapses the card cleanly
 *  instead of leaving gaps. The shipped order reproduces the previous hero
 *  exactly (poster left; title / meta / genres stacked; KPI strip and action
 *  cluster as a footer row at the bottom).
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
  eyebrow?: ReactNode;
  /** Resolved Steam app id for the "Players Now" KPI. */
  steamAppId?: number | null;
  /** Info-row meta fragments (Store). Library derives its own when omitted. */
  metaItems?: ReactNode[];
  /** Right-aligned action cluster (Store). Library uses <GameLaunchActions>. */
  actions?: ReactNode;
  /** Friends-playing strip target (defaults to the game when present). */
  friends?: { gameName: string; gameId: string } | null;
  /** Banner height profile. Defaults to "cinematic" for Library, "compact" for Store. */
  variant?: "cinematic" | "compact";
  /** Optional rating score to show in meta row (0-100) */
  rating?: number | null;
  /** Genre tags to show as chips */
  genres?: string[];
  /** Callback to change tabs (e.g. "achievements", "activity", "reviews") */
  onTabChange?: (tab: any) => void;
  /** Available screenshot URLs for cycling and full-art inspection */
  screenshots?: string[];
  /** Optional custom lightbox opener (delegates to parent if provided) */
  onOpenLightbox?: (src: string, index?: number) => void;
}

/** Content-column elements, in their shipped order. `background` and `poster`
 *  live outside the column (absolute layer / inner flex row) and are handled
 *  separately in the dock logic below. */
const CONTENT_KEYS: HeroElementKey[] = ["title", "meta", "genres", "kpis", "actions"];

/** The two elements that form the footer row when they are adjacent. */
const FOOTER_KEYS: HeroElementKey[] = ["kpis", "actions"];

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
  genres: genresProp,
  onTabChange,
  screenshots,
  onOpenLightbox,
}: GameHeroProps) {
  const { t } = useLanguage();

  const isGame = !!game;
  const name = game?.name ?? nameProp ?? "";
  const displayName = game ? gameDisplayName(game) : name;
  const coverUrl = game?.coverArtUrl ?? coverProp ?? null;
  const bannerUrl = game?.bannerUrl ?? bannerProp ?? null;
  const accentSrc = accentProp ?? coverUrl ?? bannerUrl ?? null;
  const logoUrl = game?.logoUrl ?? logoProp ?? null;
  const genres = game?.genres ?? genresProp ?? [];
  const steamAppId = useMemo(
    () => (steamAppIdProp != null ? resolveSteamAppId(undefined, steamAppIdProp) : game ? resolveSteamAppId(game) : null),
    [steamAppIdProp, game]
  );
  const rating = ratingProp ?? (game?.igdbRating || game?.criticRating) ?? null;

  const [coverErrored, setCoverErrored] = useState(false);
  const [logoErrored, setLogoErrored] = useState(false);
  const [sgdbPosterFailed, setSgdbPosterFailed] = useState(false);
  const {
    autoGameAccent,
    showGameArtBackdrop,
    showHeroTilt = true,
    showHeroBackdropControls = true,
    showHeroInteractiveControls = true,
  } = useSettings();
  const { currentTheme } = useTheme();
  const isAdaptive = currentTheme === "adaptive";
  const gamePalette = useGameAccent(accentSrc || undefined);

  // Publish the game's artwork URL so AdaptiveThemeSync and GameAccentSync
  // apply and retain this game's palette app-wide across navigation.
  usePublishGameArtwork(accentSrc);

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
    if (isAdaptive || !autoGameAccent || !gamePalette) return;
    applyGameAccentFamily(document.documentElement, gamePalette);
    document.documentElement.dataset.gameAccent = "true";
  }, [isAdaptive, autoGameAccent, gamePalette]);

  const heroRef = useRef<HTMLDivElement | null>(null);
  const [isInView, setIsInView] = useState(true);

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const animatedMediaEnabled = useAnimatedMediaEnabled();

  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(entry.isIntersecting && entry.intersectionRatio > 0.05);
      },
      { threshold: [0, 0.05, 0.2] }
    );

    observer.observe(el);

    const handleVisibility = () => {
      if (document.hidden) {
        setIsInView(false);
      } else {
        const rect = el.getBoundingClientRect();
        const inViewport = rect.top < window.innerHeight && rect.bottom > 0;
        setIsInView(inViewport);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const navigate = useNavigate();
  const { showToast } = useToast();

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reduceMotion || !showHeroTilt || !heroRef.current) return;
      const rect = heroRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const tiltX = (x - 0.5) * 2;
      const tiltY = (y - 0.5) * 2;
      const el = heroRef.current;
      el.style.setProperty("--mouse-x", `${(x * 100).toFixed(1)}%`);
      el.style.setProperty("--mouse-y", `${(y * 100).toFixed(1)}%`);
      el.style.setProperty("--tilt-x", tiltX.toFixed(3));
      el.style.setProperty("--tilt-y", tiltY.toFixed(3));
      el.style.setProperty("--hero-hovered", "1");
    },
    [reduceMotion]
  );

  const handlePointerLeave = useCallback(() => {
    if (!heroRef.current) return;
    const el = heroRef.current;
    el.style.setProperty("--tilt-x", "0");
    el.style.setProperty("--tilt-y", "0");
    el.style.setProperty("--hero-hovered", "0");
  }, []);

  // Ambient background ladder — animated SteamGridDB hero leads (unless reduced
  // motion is requested), then Steam CDN banner, SteamGridDB banner, screenshots, and game cover.
  const steamCdnBanner =
    isGame && steamAppId != null
      ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/library_hero.jpg`
      : null;

  const allBackdrops = useMemo(() => {
    const list: string[] = [];
    if (!reduceMotion && animatedMediaEnabled && sgdbHeroAnimated) {
      list.push(sgdbHeroAnimated);
    }
    if (steamCdnBanner) list.push(steamCdnBanner);
    if (sgdbHeroStatic) list.push(sgdbHeroStatic);
    if (bannerUrl) list.push(bannerUrl);
    if (screenshots && screenshots.length > 0) {
      for (const s of screenshots) {
        if (s && !list.includes(s)) list.push(s);
      }
    }
    if (coverUrl && !list.includes(coverUrl)) {
      list.push(coverUrl);
    }
    return list;
  }, [
    reduceMotion,
    animatedMediaEnabled,
    sgdbHeroAnimated,
    steamCdnBanner,
    sgdbHeroStatic,
    bannerUrl,
    screenshots,
    coverUrl,
  ]);

  const [activeBackdropIdx, setActiveBackdropIdx] = useState(0);

  useEffect(() => {
    setActiveBackdropIdx(0);
  }, [name, steamAppId]);

  const currentBackdrop =
    allBackdrops.length > 0
      ? allBackdrops[Math.min(activeBackdropIdx, allBackdrops.length - 1)]
      : null;

  const handleNextBackdrop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (allBackdrops.length <= 1) return;
      setActiveBackdropIdx((prev) => (prev + 1) % allBackdrops.length);
    },
    [allBackdrops.length]
  );

  const handlePrevBackdrop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (allBackdrops.length <= 1) return;
      setActiveBackdropIdx((prev) => (prev - 1 + allBackdrops.length) % allBackdrops.length);
    },
    [allBackdrops.length]
  );

  // Lightbox for full artwork and poster inspection
  const [internalLightboxOpen, setInternalLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState(0);

  const posterSrc = coverUrl ?? sgdbGridUrl;

  const handleOpenPoster = useCallback(() => {
    const src = posterSrc;
    if (!src) return;
    if (onOpenLightbox) {
      onOpenLightbox(src);
      return;
    }
    setLightboxImages([src]);
    setLightboxIdx(0);
    setInternalLightboxOpen(true);
  }, [posterSrc, onOpenLightbox]);

  const handleOpenBackdrop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!currentBackdrop) return;
      if (onOpenLightbox) {
        onOpenLightbox(currentBackdrop, activeBackdropIdx);
        return;
      }
      setLightboxImages(allBackdrops.length > 0 ? allBackdrops : [currentBackdrop]);
      setLightboxIdx(activeBackdropIdx);
      setInternalLightboxOpen(true);
    },
    [currentBackdrop, allBackdrops, activeBackdropIdx, onOpenLightbox]
  );

  const handleCopyTitle = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(displayName);
        showToast(t("hero.titleCopied"), "success");
      } catch {
        // ignore
      }
    },
    [displayName, showToast, t]
  );

  const handleOpenSteamCommunity = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (steamAppId != null) {
        openUrl(`https://steamcommunity.com/app/${steamAppId}`).catch(() => undefined);
      }
    },
    [steamAppId]
  );

  const handleGenreClick = useCallback(
    (g: string) => {
      if (isGame) {
        navigate(`/library?genre=${encodeURIComponent(g)}`);
      } else {
        navigate(`/store?genre=${encodeURIComponent(g)}`);
      }
    },
    [isGame, navigate]
  );

  // Achievement progress — prefer the multi-source cache (Steam / GOG /
  // Epic / Retro / manual) so non-Steam games surface real progress, then
  // fall back to the legacy Steam-synced array. Library only.
  const { getAchievementSummary } = useAchievements();
  const achData = isGame && game ? getAchievementSummary(game.id) : null;
  const achievements = game?.steamAchievements;
  const achUnlocked =
    achData?.unlocked ?? achievements?.filter((a) => a.achieved).length ?? 0;
  const achTotal = achData?.total ?? achievements?.length ?? 0;
  const achPercent = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : null;

  const variant = variantProp ?? (isGame ? "cinematic" : "compact");
  const friends = friendsProp ?? (isGame ? { gameName: gameDisplayName(game), gameId: game.id } : null);

  // ── Layout Studio: per-scope element order + visibility ──────────────
  const heroScope = isGame ? "game" : "store";
  const { order, hidden } = useHeroElementLayout(heroScope);
  const gridLayout = useHeroGridLayout(heroScope);
  const gridMode = gridLayout !== null;

  const isElementVisible = (key: HeroElementKey) => hidden[key] !== false;

  const orderIndex = (key: HeroElementKey) => {
    const index = order.indexOf(key);
    return index === -1 ? HERO_ELEMENTS.indexOf(key) : index;
  };

  // ── Info-row meta ────────────────────────────────────────────
  const ratingBadgeClass =
    rating && rating >= 75
      ? "game-hero-rating-badge--high"
      : rating && rating >= 50
      ? "game-hero-rating-badge--mid"
      : "game-hero-rating-badge--low";

  const metaRow = isGame ? (
    <>
      {showHeroInteractiveControls ? (
        <button
          type="button"
          className="game-hero-meta-item game-hero-meta-item--btn"
          onClick={() => {
            if (game?.platform) {
              navigate(`/library?platform=${encodeURIComponent(game.platform)}`);
            }
          }}
          title={t("hero.filterByPlatform", { platform: game!.platform })}
        >
          <IconPlatform size={12} />
          <span>{game!.platform}</span>
        </button>
      ) : (
        <span className="game-hero-meta-item">
          <IconPlatform size={12} />
          <span>{game!.platform}</span>
        </span>
      )}
      <span className="game-hero-meta-dot" />
      <span>{t("hero.playTime")}: {game!.playTime}</span>
      {rating && (
        <>
          <span className="game-hero-meta-dot" />
          {showHeroInteractiveControls && onTabChange ? (
            <button
              type="button"
              className={`game-hero-rating-badge ${ratingBadgeClass} game-hero-rating-badge--interactive`}
              title={t("hero.viewReviews")}
              onClick={() => onTabChange("reviews")}
            >
              <IconStar size={11} className="game-hero-rating-star" />
              <span>{Math.round(rating)}</span>
            </button>
          ) : (
            <span className={`game-hero-rating-badge ${ratingBadgeClass}`} title={t("ratings.title")}>
              <IconStar size={11} className="game-hero-rating-star" />
              <span>{Math.round(rating)}</span>
            </span>
          )}
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
          {showHeroInteractiveControls && onTabChange ? (
            <button
              type="button"
              className={`game-hero-rating-badge ${ratingBadgeClass} game-hero-rating-badge--interactive`}
              title={t("hero.viewReviews")}
              onClick={() => onTabChange("reviews")}
            >
              <IconStar size={11} className="game-hero-rating-star" />
              <span>{Math.round(rating)}</span>
            </button>
          ) : (
            <span className={`game-hero-rating-badge ${ratingBadgeClass}`} title={t("ratings.title")}>
              <IconStar size={11} className="game-hero-rating-star" />
              <span>{Math.round(rating)}</span>
            </span>
          )}
        </>
      )}
    </>
  );

  // ── KPI strip ────────────────────────────────────────────────
  const kpis = (
    <>
      {steamAppId != null &&
        (showHeroInteractiveControls ? (
          <div
            className="game-hero-kpi-interactive game-hero-kpi-interactive--active"
            onClick={handleOpenSteamCommunity}
            title={t("hero.viewCommunityHub")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleOpenSteamCommunity(e as unknown as React.MouseEvent);
              }
            }}
          >
            <KpiTile
              glass
              size="sm"
              label={t("hero.playersNow")}
              icon={<IconUsers size={12} />}
              value={<PlayerCountBadge appId={steamAppId} />}
              intent="accent"
            />
          </div>
        ) : (
          <KpiTile
            glass
            size="sm"
            label={t("hero.playersNow")}
            icon={<IconUsers size={12} />}
            value={<PlayerCountBadge appId={steamAppId} />}
            intent="accent"
          />
        ))}
      {isGame &&
        (showHeroInteractiveControls && onTabChange ? (
          <div
            className="game-hero-kpi-interactive game-hero-kpi-interactive--active"
            onClick={() => onTabChange("activity")}
            title={t("hero.viewActivity")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTabChange("activity");
              }
            }}
          >
            <KpiTile
              glass
              size="sm"
              label={t("hero.playTime")}
              icon={<IconClock size={12} />}
              value={formatHeroPlayTime(game!.playTime)}
              subtext={game!.installed ? t("filter.installed") : t("game.notInstalled")}
              intent={game!.installed ? "success" : "default"}
            />
          </div>
        ) : (
          <KpiTile
            glass
            size="sm"
            label={t("hero.playTime")}
            icon={<IconClock size={12} />}
            value={formatHeroPlayTime(game!.playTime)}
            subtext={game!.installed ? t("filter.installed") : t("game.notInstalled")}
            intent={game!.installed ? "success" : "default"}
          />
        ))}
      {achPercent != null &&
        (showHeroInteractiveControls && onTabChange ? (
          <div
            className="game-hero-kpi-interactive game-hero-kpi-interactive--active"
            onClick={() => onTabChange("achievements")}
            title={t("hero.viewAchievements")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTabChange("achievements");
              }
            }}
          >
            <KpiTile
              glass
              size="sm"
              label={t("nav.achievements")}
              icon={<IconShield size={12} />}
              value={`${achPercent}%`}
              subtext={`${achUnlocked}/${achTotal}`}
              intent={achPercent >= 100 ? "success" : "default"}
            />
          </div>
        ) : (
          <KpiTile
            glass
            size="sm"
            label={t("nav.achievements")}
            icon={<IconShield size={12} />}
            value={`${achPercent}%`}
            subtext={`${achUnlocked}/${achTotal}`}
            intent={achPercent >= 100 ? "success" : "default"}
          />
        ))}
    </>
  );

  // ── Element payloads ─────────────────────────────────────────────────
  const blockInner: Record<string, ReactNode> = {
    title: (
      <div className="game-hero__head">
        {eyebrow && <span className="game-hero__eyebrow">{eyebrow}</span>}

        {logoUrl && !logoErrored ? (
          <img
            src={logoUrl}
            alt={displayName}
            className="game-hero-logo"
            onError={() => setLogoErrored(true)}
          />
        ) : (
          <h1 className="game-hero-title">{displayName}</h1>
        )}
      </div>
    ),
    meta: <div className="game-hero-meta">{metaRow}</div>,
    genres: (
      <>
        {genres.length > 0 && (
          <div className="game-hero-genres">
            {genres.slice(0, 5).map((g) =>
              showHeroInteractiveControls ? (
                <button
                  key={g}
                  type="button"
                  className="game-hero-genre-chip game-hero-genre-chip--interactive"
                  onClick={() => handleGenreClick(g)}
                  title={t("hero.filterByGenre", { genre: g })}
                >
                  <IconTag size={10} className="game-hero-genre-chip-icon" />
                  <span>{g}</span>
                </button>
              ) : (
                <span key={g} className="game-hero-genre-chip">
                  <IconTag size={10} className="game-hero-genre-chip-icon" />
                  <span>{g}</span>
                </span>
              ),
            )}
          </div>
        )}
        {friends && (
          <FriendsPlayingStrip gameName={friends.gameName} gameId={friends.gameId} />
        )}
      </>
    ),
    kpis: (
      <PageWidget page="game" widget="kpis">
        <div className="game-hero__kpis ui-item-kpis">{kpis}</div>
      </PageWidget>
    ),
    actions: (
      <div className="game-hero__actions">
        {actions ??
          (isGame ? <GameLaunchActions game={game!} onLaunch={onLaunch!} size="sm" /> : null)}
      </div>
    ),
  };

  // The genre block only exists when it has something to show (matching the
  // old conditional chips + friends render); the others always render so the
  // footer keeps its structure.
  const canRenderBlock = (key: HeroElementKey) =>
    key === "genres" ? genres.length > 0 || !!friends : true;

  // Visible content keys, sorted into their persisted order.
  const visibleContentKeys = CONTENT_KEYS.filter(
    (key) => isElementVisible(key) && canRenderBlock(key)
  ).sort((a, b) => orderIndex(a) - orderIndex(b));

  // `kpis` + `actions` sit side by side as a footer row when they are
  // adjacent in the order. Grouping them and positioning the group at the
  // earlier index is equivalent to placing each individually, so the row can
  // both stay together and move above/below the other blocks.
  const kpisPos = visibleContentKeys.indexOf("kpis");
  const actionsPos = visibleContentKeys.indexOf("actions");
  const groupFooter =
    kpisPos !== -1 && actionsPos !== -1 && Math.abs(kpisPos - actionsPos) === 1;

  // Pin the trailing run of footer blocks to the bottom of the card (as the
  // shipped layout does) with an auto top margin, so hiding the head blocks
  // doesn't leave the footer floating mid-card. If the footer isn't last, we
  // let it follow the chosen order naturally.
  let trailingStart = visibleContentKeys.length;
  while (trailingStart > 0) {
    const key = visibleContentKeys[trailingStart - 1];
    if (FOOTER_KEYS.includes(key)) trailingStart--;
    else break;
  }
  const pinTrailingFooter =
    trailingStart < visibleContentKeys.length && trailingStart > 0;
  const boundaryKey = pinTrailingFooter ? visibleContentKeys[trailingStart] : null;

  // The content column docks against the poster: whichever side has the
  // smaller order index sits first in the `.game-hero__inner` row, so moving
  // the poster after a content block docks it to the right.
  const contentOrder = visibleContentKeys.length
    ? Math.min(...visibleContentKeys.map(orderIndex))
    : Number.POSITIVE_INFINITY;
  const posterOrder = orderIndex("poster");

  const showPoster = !!posterSrc && !coverErrored;
  const posterHiddenByUser = !isElementVisible("poster");
  const posterVisible = !posterHiddenByUser && showPoster;
  const showAmbientArt =
    isElementVisible("background") && !!currentBackdrop && showGameArtBackdrop && isInView;

  const heroClassName = [
    "game-hero",
    `game-hero--${variant}`,
    isGame ? "" : "game-hero--store",
    // Only an explicit hide collapses the card; a game that simply has no
    // poster (or whose art failed to load) keeps the original backdrop cap.
    posterHiddenByUser ? "game-hero--no-poster" : "",
    gridMode ? "game-hero--grid" : "",
    !showHeroTilt ? "game-hero--no-tilt" : "",
    !showHeroInteractiveControls ? "game-hero--no-interactive" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const blockStyle = (index: number, pinned: boolean): CSSProperties => ({
    order: index,
    marginTop: pinned ? "auto" : undefined,
  });

  const renderBlock = (key: HeroElementKey, pinned: boolean) => (
    <div
      key={key}
      className={`game-hero__block game-hero__block--${key}`}
      style={blockStyle(orderIndex(key), pinned)}
    >
      {blockInner[key]}
    </div>
  );

  const contentNodes: ReactNode[] = [];
  if (groupFooter) {
    const footerPinned =
      pinTrailingFooter && (boundaryKey === "kpis" || boundaryKey === "actions");
    contentNodes.push(
      <div
        key="footer"
        className="game-hero__footer"
        style={{
          order: Math.min(orderIndex("kpis"), orderIndex("actions")),
          marginTop: footerPinned ? "auto" : undefined,
        }}
      >
        {renderBlock("kpis", false)}
        {renderBlock("actions", false)}
      </div>
    );
  }
  for (const key of visibleContentKeys) {
    if (groupFooter && FOOTER_KEYS.includes(key)) continue;
    contentNodes.push(renderBlock(key, pinTrailingFooter && boundaryKey === key));
  }

  // ── Grid-mode rendering ─────────────────────────────────────────────
  // Only used when an authored grid exists; the flex subtree above stays the
  // default for every existing user. Each item carries its rect as CSS custom
  // properties, and DOM order follows the row-major reading order.
  const gridStyle = (key: HeroGridItemKey): CSSProperties =>
    ({
      "--hero-col": gridLayout![key].col,
      "--hero-col-span": gridLayout![key].colSpan,
      "--hero-row": gridLayout![key].row,
      "--hero-row-span": gridLayout![key].rowSpan,
    }) as CSSProperties;

  const gridItemKeys = HERO_GRID_ITEM_KEYS.filter((key) => {
    if (key === "poster") return posterVisible;
    return isElementVisible(key) && canRenderBlock(key);
  });
  const orderedGridKeys = gridLayout
    ? sortHeroGridItems(gridLayout, gridItemKeys)
    : [];

  const renderGridItem = (key: HeroGridItemKey) => {
    if (key === "poster") {
      return (
        <div
          key="poster"
          className={`game-hero__poster game-hero__block--poster${
            !showHeroInteractiveControls ? " game-hero__poster--static" : ""
          }`}
          style={gridStyle("poster")}
          onClick={showHeroInteractiveControls ? handleOpenPoster : undefined}
          onKeyDown={
            showHeroInteractiveControls
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpenPoster();
                  }
                }
              : undefined
          }
          tabIndex={showHeroInteractiveControls ? 0 : undefined}
          role={showHeroInteractiveControls ? "button" : undefined}
          title={showHeroInteractiveControls ? t("hero.viewPoster") : undefined}
          aria-label={showHeroInteractiveControls ? t("hero.viewPoster") : undefined}
        >
          <img
            src={posterSrc!}
            alt={displayName}
            className="game-hero__poster-img"
            onError={() => {
              if (sgdbGridUrl) {
                setSgdbPosterFailed(true);
              } else {
                setCoverErrored(true);
              }
            }}
          />
          {showHeroTilt && <div className="game-hero__poster-sheen" aria-hidden="true" />}
          {showHeroInteractiveControls && (
            <div className="game-hero__poster-overlay" aria-hidden="true">
              <span className="game-hero__poster-inspect-pill">
                <IconMaximize size={11} />
                <span>{t("hero.viewPoster")}</span>
              </span>
            </div>
          )}
          {isGame && game!.installed && (
            <span className="game-hero__poster-badge game-hero__poster-badge--installed">
              {t("filter.installed")}
            </span>
          )}
        </div>
      );
    }
    return (
      <div
        key={key}
        className={`game-hero__block game-hero__block--${key}`}
        style={gridStyle(key)}
      >
        {blockInner[key]}
      </div>
    );
  };

  return (
    <div
      ref={heroRef}
      className={heroClassName}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
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
      {/* Background art: a blurred copy of the banner/cover with glow. */}
      {showAmbientArt && currentBackdrop ? (
        <>
          <img
            src={currentBackdrop}
            alt=""
            aria-hidden="true"
            style={{ display: "none" }}
            onError={() => {
              if (allBackdrops.length > 1) {
                setActiveBackdropIdx((prev) => (prev + 1) % allBackdrops.length);
              }
            }}
          />
          <div
            className="game-hero__bg"
            style={{ backgroundImage: `url("${currentBackdrop}")` }}
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="game-hero__bg game-hero__bg--fallback" aria-hidden="true" />
      )}
      <div className="game-hero__scrim" aria-hidden="true" />
      {showHeroTilt && <div className="game-hero__spotlight" aria-hidden="true" />}

      {/* Interactive Backdrop & Wallpaper Toolbar */}
      {showHeroBackdropControls && (
        <div className="game-hero__backdrop-controls">
          {allBackdrops.length > 1 && (
            <>
              <button
                type="button"
                className="game-hero__ctrl-btn game-hero__ctrl-btn--icon-only"
                onClick={handlePrevBackdrop}
                title={t("hero.prevArtwork")}
                aria-label={t("hero.prevArtwork")}
              >
                <IconChevronLeft size={13} />
              </button>
              <span className="game-hero__ctrl-counter">
                <IconImage size={11} className="game-hero__ctrl-icon" />
                <span>{activeBackdropIdx + 1}/{allBackdrops.length}</span>
              </span>
              <button
                type="button"
                className="game-hero__ctrl-btn game-hero__ctrl-btn--icon-only"
                onClick={handleNextBackdrop}
                title={t("hero.nextArtwork")}
                aria-label={t("hero.nextArtwork")}
              >
                <IconChevronRight size={13} />
              </button>
              <div className="game-hero__ctrl-divider" aria-hidden="true" />
            </>
          )}
          {currentBackdrop && (
            <button
              type="button"
              className="game-hero__ctrl-btn"
              onClick={handleOpenBackdrop}
              title={t("hero.viewWallpaper")}
            >
              <IconMaximize size={12} />
              <span className="game-hero__ctrl-label">{t("hero.viewWallpaper")}</span>
            </button>
          )}
          <button
            type="button"
            className="game-hero__ctrl-btn game-hero__ctrl-btn--icon-only"
            onClick={handleCopyTitle}
            title={t("hero.copyTitle")}
            aria-label={t("hero.copyTitle")}
          >
            <IconCopy size={13} />
          </button>
        </div>
      )}

      {gridMode ? (
        <div className="game-hero__grid">
          {orderedGridKeys.map((key) => renderGridItem(key))}
        </div>
      ) : (
        <div className="game-hero__inner">
          {/* 2:3 poster — docks left or right based on its order index. */}
          {posterVisible && (
            <div
              className={`game-hero__poster${!showHeroInteractiveControls ? " game-hero__poster--static" : ""}`}
              style={{ order: posterOrder }}
              onClick={showHeroInteractiveControls ? handleOpenPoster : undefined}
              onKeyDown={
                showHeroInteractiveControls
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleOpenPoster();
                      }
                    }
                  : undefined
              }
              tabIndex={showHeroInteractiveControls ? 0 : undefined}
              role={showHeroInteractiveControls ? "button" : undefined}
              title={showHeroInteractiveControls ? t("hero.viewPoster") : undefined}
              aria-label={showHeroInteractiveControls ? t("hero.viewPoster") : undefined}
            >
              <img
                src={posterSrc!}
                alt={displayName}
                className="game-hero__poster-img"
                onError={() => {
                  if (sgdbGridUrl) {
                    setSgdbPosterFailed(true);
                  } else {
                    setCoverErrored(true);
                  }
                }}
              />
              {showHeroTilt && <div className="game-hero__poster-sheen" aria-hidden="true" />}
              {showHeroInteractiveControls && (
                <div className="game-hero__poster-overlay" aria-hidden="true">
                  <span className="game-hero__poster-inspect-pill">
                    <IconMaximize size={11} />
                    <span>{t("hero.viewPoster")}</span>
                  </span>
                </div>
              )}
              {isGame && game.installed && (
                <span className="game-hero__poster-badge game-hero__poster-badge--installed">
                  {t("filter.installed")}
                </span>
              )}
            </div>
          )}

          {/* Content column — an orderable block stack. */}
          {visibleContentKeys.length > 0 && (
            <div
              className="game-hero__content"
              style={{ order: contentOrder }}
            >
              {contentNodes}
            </div>
          )}
        </div>
      )}

      {/* Built-in Lightbox for inspecting poster or wallpaper */}
      {internalLightboxOpen && (
        <ImageLightbox
          images={lightboxImages}
          currentIndex={lightboxIdx}
          isOpen={internalLightboxOpen}
          onClose={() => setInternalLightboxOpen(false)}
          onSelectIndex={setLightboxIdx}
          title={displayName}
        />
      )}
    </div>
  );
}
