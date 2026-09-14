import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { KpiTile } from "../ui";
import PageWidget from "../PageWidget";
import { type Game } from "../../types/game";
import { useGameAccent } from "../../hooks/useGameAccent";
import { useSettings, useHeroElementLayout, useHeroGridLayout } from "../../context/SettingsContext";
import { applyGameAccentFamily } from "../../utils/color";
import { useAchievements } from "../../context/AchievementContext";
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
import { IconClock, IconPlatform, IconShield, IconUsers, IconStar } from "./icons";
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
}: GameHeroProps) {
  const { t } = useLanguage();

  const isGame = !!game;
  const name = game?.name ?? nameProp ?? "";
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
  const [ambientStep, setAmbientStep] = useState(0);
  const { autoGameAccent, showGameArtBackdrop } = useSettings();
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

  // Ambient background ladder — animated SteamGridDB hero leads (unless reduced
  // motion is requested), then Steam CDN banner, SteamGridDB banner, and game cover.
  const steamCdnBanner =
    isGame && steamAppId != null
      ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/library_hero.jpg`
      : null;
  const ambientCandidates = useMemo(
    () => {
      const preferred = reduceMotion
        ? [steamCdnBanner, sgdbHeroStatic, bannerUrl, coverUrl]
        : [sgdbHeroAnimated, steamCdnBanner, sgdbHeroStatic, bannerUrl, coverUrl];
      return preferred.filter((u): u is string => !!u);
    },
    [reduceMotion, sgdbHeroAnimated, steamCdnBanner, sgdbHeroStatic, bannerUrl, coverUrl]
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
  const friends = friendsProp ?? (isGame ? { gameName: game.name, gameId: game.id } : null);

  // ── Layout Studio: per-scope element order + visibility ──────────────
  // The hero is shared by the Library game page (scope "game") and the Store
  // detail page (scope "store"), so the persisted layout is resolved from the
  // active scope. `order` is always complete; `hidden` only carries OFF keys.
  const heroScope = isGame ? "game" : "store";
  const { order, hidden } = useHeroElementLayout(heroScope);
  // Optional authored grid layout. `null` means no grid has been stored, so
  // the hero keeps rendering its content-driven flex/`order` layout.
  const gridLayout = useHeroGridLayout(heroScope);
  const gridMode = gridLayout !== null;

  const isElementVisible = (key: HeroElementKey) => hidden[key] !== false;

  // Defensive index lookup: the persisted order is normalized to include every
  // key, but a missing/unknown key must never break the ordering.
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
      <span className="game-hero-meta-item">
        <IconPlatform size={12} />
        {game!.platform}
      </span>
      <span className="game-hero-meta-dot" />
      <span>{t("hero.playTime")}: {game!.playTime}</span>
      {rating && (
        <>
          <span className="game-hero-meta-dot" />
          <span className={`game-hero-rating-badge ${ratingBadgeClass}`} title={t("ratings.title")}>
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
          <span className={`game-hero-rating-badge ${ratingBadgeClass}`} title={t("ratings.title")}>
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

  // ── Element payloads ─────────────────────────────────────────────────
  // The `title` block is the eyebrow + logo/title; `meta` and `genres` are
  // split out of the old `.game-hero__head` so each is independently orderable.
  const blockInner: Record<string, ReactNode> = {
    title: (
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
      </div>
    ),
    meta: <div className="game-hero-meta">{metaRow}</div>,
    genres: (
      <>
        {genres.length > 0 && (
          <div className="game-hero-genres">
            {genres.slice(0, 4).map((g) => (
              <span key={g} className="game-hero-genre-chip">
                {g}
              </span>
            ))}
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

  const posterSrc = coverUrl ?? sgdbGridUrl;
  const showPoster = !!posterSrc && !coverErrored;
  const posterHiddenByUser = !isElementVisible("poster");
  const posterVisible = !posterHiddenByUser && showPoster;
  const showAmbientArt =
    isElementVisible("background") && !!ambientSrc && showGameArtBackdrop && isInView;

  const heroClassName = [
    "game-hero",
    `game-hero--${variant}`,
    isGame ? "" : "game-hero--store",
    // Only an explicit hide collapses the card; a game that simply has no
    // poster (or whose art failed to load) keeps the original backdrop cap.
    posterHiddenByUser ? "game-hero--no-poster" : "",
    gridMode ? "game-hero--grid" : "",
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
          className="game-hero__poster game-hero__block--poster"
          style={gridStyle("poster")}
          aria-hidden="true"
        >
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
      {/* Background art: a blurred copy of the banner/cover with glow.
          Absolutely positioned — its order index is intentionally ignored;
          only visibility gates it (plus the existing art-backdrop setting). */}
      {showAmbientArt ? (
        <>
          <img
            src={ambientSrc!}
            alt=""
            aria-hidden="true"
            style={{ display: "none" }}
            onError={() => setAmbientStep((s) => s + 1)}
          />
          <div
            className="game-hero__bg"
            style={{ backgroundImage: `url("${ambientSrc}")` }}
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="game-hero__bg game-hero__bg--fallback" aria-hidden="true" />
      )}
      <div className="game-hero__scrim" aria-hidden="true" />

      {gridMode ? (
        /* Grid mode: kpis and actions are independent cells (no footer
           wrapper); `.game-hero__actions` keeps its right alignment. */
        <div className="game-hero__grid">
          {orderedGridKeys.map((key) => renderGridItem(key))}
        </div>
      ) : (
        <div className="game-hero__inner">
          {/* 2:3 poster — docks left or right based on its order index. */}
          {posterVisible && (
            <div
              className="game-hero__poster"
              style={{ order: posterOrder }}
              aria-hidden="true"
            >
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
    </div>
  );
}
