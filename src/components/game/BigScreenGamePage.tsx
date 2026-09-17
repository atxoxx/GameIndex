// BigScreenGamePage — PS5 tabbed Game Hub for Big Screen mode.
//
// Information architecture, top to bottom:
//
//   ┌──────────────────────────────────────────────────┐
//   │ Hero (a header, not a landing page)               │
//   │   ‹ Back      logo / title · meta pills           │
//   │   [ PRIMARY ACTION ]  [Trailer]  [Find download]  │
//   ├──────────────────────────────────────────────────┤
//   │ Tab bar — the page's navigation spine (LB / RB)   │
//   │   [Overview][Media][Specs][Achievements]…         │
//   ├──────────────────────────────────────────────────┤
//   │ Active tab body (owns its own scroll)             │
//   └──────────────────────────────────────────────────┘
//
// Controller model
// ────────────────
//   • Entry: focus lands on the primary action (Play / Install / Force
//     Close) — the one thing the user came here for.
//   • Down from the hero: the tab bar. Left/Right cycles the tabs
//     (the strip is a rail, so it wraps at the ends). LB/RB does the
//     same and parks focus on the tab it selects.
//   • A on a tab: selects it and drops focus into the tab body; if the
//     body has nothing focusable, focus stays on the tab so the strip
//     remains the anchor instead of jumping somewhere arbitrary.
//   • B: walks up one level via the shell's route resolver (this page
//     deliberately registers no back handler of its own).
//
// Only the hero and the tab bar stay put; the tab body scrolls. The hero
// is intentionally short so the tab bar reads as the spine of the page
// rather than a divider under a poster.
//
// Paused hero: `paused={activeTab === "overview"}` freezes the Ken-Burns /
// cross-fade cycle on the landing tab so the user has time to read the
// cover, title, and meta strip.

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { Game } from "../../types/game";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { usePublishGameArtwork } from "../../utils/activeGameArtwork";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useGameBackdropArt } from "../../hooks/useGameBackdropArt";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import PlayerCountBadge from "../PlayerCountBadge";
import { openUrl } from "@tauri-apps/plugin-opener";
import DownloadModal from "../DownloadModal";
import "../../styles/activity.css";
import "../../styles/achievements.css";
import "../../styles/reviews.css";
import "../../styles/weblinks.css";
import BigScreenHeroBackground from "./BigScreenHeroBackground";
import SpecsCard from "./SpecsCard";
import ReleasesCard from "./ReleasesCard";
import LanguagesSection from "./LanguagesSection";
import ScreenshotsSection from "./ScreenshotsSection";
import VideosSection from "./VideosSection";
import StorylineSection from "./StorylineSection";
import AboutSection from "./AboutSection";
import SystemRequirementsCard from "./SystemRequirementsCard";
import RatingsKpiCard from "./RatingsKpiCard";
import TimeToBeatCard from "./TimeToBeatCard";
import CrackWatchCard from "../CrackWatchCard";
import GameRelationsCard from "../GameRelationsCard";
import ReviewsTab from "../ReviewsTab";
import AchievementsTab from "../AchievementsTab";
import WebLinksTab from "../WebLinksTab";
import { GameActivityTab } from "./GameActivityTab";
import BigScreenPill from "../bigscreen/BigScreenPill";
import BigScreenMetaStrip from "../bigscreen/BigScreenMetaStrip";
import BigScreenLightbox from "../bigscreen/BigScreenLightbox";
import BigScreenTabBar, {
  type TabDef,
} from "../bigscreen/BigScreenTabBar";
import BigScreenTabPanel from "../bigscreen/BigScreenTabPanel";
import {
  extractYear,
  formatLastPlayed,
  isVideoUrl,
} from "../bigscreen/bigscreenFormat";
import { bigScreenParentOf } from "../../bigscreen/registry";
import BigScreenGameHeroActions, {
  focusPrimaryAction,
} from "./BigScreenGameHeroActions";
import BigScreenRailScroller from "./BigScreenRailScroller";
import { cycleTabId, focusTabLanding } from "./bigscreenGameTabs";

// ── Self-contained entry ──────────────────────────────────────────
// Resolves the game from the route param, so the route registry can mount
// this component with zero props (see src/bigscreen/registry.tsx). Back
// defers to the shell's route resolver rather than hardcoding /library.

export default function BigScreenGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { getGame } = useGames();
  const game = gameId ? getGame(gameId) : undefined;

  usePublishGameArtwork(game?.coverArtUrl ?? game?.bannerUrl);

  const handleBack = useCallback(() => {
    navigate(bigScreenParentOf(location.pathname) ?? "/home");
  }, [navigate, location.pathname]);

  if (!game) {
    return <BigScreenGameNotFound onBack={handleBack} />;
  }

  return <BigScreenGamePageContent game={game} onBack={handleBack} />;
}

interface BigScreenGamePageContentProps {
  /** The currently-viewed game. */
  game: Game;
  /** Walk up one level (the shell resolves the parent route). */
  onBack: () => void;
}

type GamePageTab =
  | "overview"
  | "media"
  | "specs"
  | "achievements"
  | "reviews"
  | "activity"
  | "more";

function BigScreenGamePageContent({ game, onBack }: BigScreenGamePageContentProps) {
  const { runningGameIds, launchGame, forceCloseGame, enrichGameMetadata } = useGames();
  const { t } = useLanguage();
  const gamepad = useGamepad();
  // Steam appid resolution for the player-count badge. Identical
  // pattern to the desktop hero: falls back to a one-shot Steam
  // name lookup for non-Steam titles and persists the resolved
  // appid back onto `game.steamAppId` via updateGame.
  const { appId: steamAppId } = useSteamAppId(game);
  const resolvedSteamAppId =
    typeof steamAppId === "number" ? steamAppId : game.steamAppId ?? null;
  const isRunning = runningGameIds.includes(game.id);
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];

  // Tab state + lightbox state.
  const [activeTab, setActiveTab] = useState<GamePageTab>("overview");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);

  // Nonce that asks the tab-landing effect to run. `null` means "don't
  // move focus" — which is what LB/RB wants: the strip stays the anchor.
  const [contentFocusRequest, setContentFocusRequest] = useState<{
    tab: GamePageTab;
    nonce: number;
  } | null>(null);
  const focusNonceRef = useRef(0);

  const resolvedLogo = useMemo(() => {
    if (game.logoUrl) return game.logoUrl;
    if (game.platform === "Steam" && game.steamAppId) {
      return `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/logo.png`;
    }
    return undefined;
  }, [game.logoUrl, game.platform, game.steamAppId]);

  const resolvedBanner = useMemo(() => {
    if (game.bannerUrl) return game.bannerUrl;
    if (game.platform === "Steam" && game.steamAppId) {
      return `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/library_hero.jpg`;
    }
    return game.coverArtUrl;
  }, [game.bannerUrl, game.platform, game.steamAppId, game.coverArtUrl]);

  // Animated hero art — SteamGridDB animated hero (APNG / animated
  // WebP) when the community has one, layered over the banner.
  const backdrop = useGameBackdropArt(game);

  const achCount = useMemo(
    () =>
      game.steamAchievements?.filter((achievement) => achievement.achieved)
        .length ?? 0,
    [game.steamAchievements],
  );

  // The hero Trailer button only ever opens a video the lightbox can
  // actually play. YouTube / Twitch links are handled (as embeds) by the
  // Media tab; advertising an unplayable file here is worse than a
  // missing button.
  const playableTrailer = useMemo(
    () => (game.videos ?? []).find(isVideoUrl) ?? null,
    [game.videos],
  );

  // Lazy metadata enrichment on mount. `metadataSource` is persisted by the
  // enrichment pipeline, so once metadata has been fetched for this game
  // (successful source or the NO_IGDB_MATCH_SOURCE sentinel) don't re-reach
  // for the network on every page open. The only exception is a game marked
  // no-match whose IGDB id later became known — fetching by id can un-gate it.
  useEffect(() => {
    setLogoError(false);
    const alreadyEnriched =
      !!game.metadataSource &&
      !(game.metadataSource === NO_IGDB_MATCH_SOURCE && game.igdbId != null);
    if (alreadyEnriched) return;
    enrichGameMetadata(game.id, game.name, game.steamAppId).catch((err) =>
      console.warn("Failed to lazy enrich game metadata on Big Screen:", err)
    );
  }, [game.id, game.name, game.steamAppId, enrichGameMetadata]);

  const tabs = useMemo(() => {
    const list: TabDef<GamePageTab>[] = [
      { id: "overview", label: t("game.tab.overview"), icon: <OverviewIcon /> },
      { id: "media", label: t("game.tab.media"), icon: <MediaIcon /> },
      { id: "specs", label: t("game.tab.specs"), icon: <SpecsIcon /> },
    ];
    if (resolvedSteamAppId) {
      list.push({
        id: "achievements",
        label: t("game.tab.achievements"),
        icon: <AchievementsIcon />,
        count: achCount,
      });
    }
    list.push(
      { id: "reviews", label: t("game.tab.reviews"), icon: <ReviewsIcon /> },
      { id: "activity", label: t("game.tab.activity"), icon: <ActivityIcon /> },
      { id: "more", label: t("game.tab.more"), icon: <MoreIcon /> }
    );
    return list;
  }, [resolvedSteamAppId, achCount, t]);

  // Land the controller on the primary action (Play / Install / Force
  // Close) instead of the decorative back chip. The marker attribute is
  // set by the action row, so this is independent of DOM or registration
  // order.
  useEffect(() => {
    focusPrimaryAction(pageRef.current);
  }, [game.id]);

  // Land focus inside the panel the user just committed to. Runs after
  // the tab bar's own "park focus on the active tab" effect (children
  // commit first), so it wins when both fire for the same press.
  useEffect(() => {
    if (!contentFocusRequest) return;
    focusTabLanding({
      root: pageRef.current,
      tabId: contentFocusRequest.tab,
      focusFirst: gamepad.focusFirst,
    });
  }, [contentFocusRequest, gamepad.focusFirst]);

  // Reset isClosing when game stops running
  useEffect(() => {
    if (!isRunning) {
      setIsClosing(false);
    }
  }, [isRunning]);

  // Bumper-cycled tab navigation (LB / RB). `registerTabCycler`
  // returns an unregister function that runs on unmount, restoring
  // BigScreenNav's LB/RB behavior when the user leaves the Game
  // Hub. While the lightbox is open we ignore bumper presses so
  // the user can't cycle tabs while a fullscreen preview is up.
  //
  // LB/RB selects a tab and leaves focus on the strip — the user is
  // browsing the spine, not entering a body. A (or Down) is what
  // commits.
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      if (lightbox) return;
      setActiveTab((prev) =>
        cycleTabId(
          tabs.map((tab) => tab.id),
          prev,
          direction,
        ),
      );
    });
  }, [gamepad.registerTabCycler, lightbox, tabs]);

  const handlePlay = () => {
    launchGame(game);
  };

  const handleForceClose = () => {
    if (isRunning) {
      setIsClosing(true);
      forceCloseGame(game);
    }
  };

  const showInstall =
    !game.installed && game.platform === "Steam" && !!game.steamAppId;

  const handleInstall = () => {
    if (!game.steamAppId) return;
    openUrl(`steam://install/${game.steamAppId}`).catch((err) =>
      console.warn("Failed to open Steam install:", err)
    );
  };

  const handleEnterTabContent = useCallback((tab: GamePageTab) => {
    // A monotonic nonce, not a timestamp: two presses in the same
    // millisecond must still each move focus.
    focusNonceRef.current += 1;
    setContentFocusRequest({ tab, nonce: focusNonceRef.current });
  }, []);

  const handleBackProps = useFocusable(onBack);

  const releaseYear = extractYear(game.releaseDate);
  const rating = game.igdbRating ?? game.criticRating;

  return (
    <div ref={pageRef} className="bigscreen-gamepage">
      {/* ── Hero (a header band, paused on Overview) ────────── */}
      <section
        className="bigscreen-gamepage-hero"
        aria-label={`${game.name} banner`}
      >
        <BigScreenHeroBackground
          bannerUrl={backdrop.staticUrl ?? resolvedBanner}
          coverArtUrl={game.coverArtUrl}
          animatedUrl={backdrop.animatedUrl}
          screenshots={game.screenshots}
          videos={game.videos}
          paused={activeTab === "overview"}
        />
        <div className="bigscreen-gamepage-hero-mask" aria-hidden />
        <div className="bigscreen-gamepage-hero-tint" aria-hidden />
        <div className="bigscreen-gamepage-hero-glow" aria-hidden />

        <div className="bigscreen-gamepage-hero-content">
          <button
            type="button"
            className="bigscreen-gamepage-hero-back"
            {...handleBackProps}
            aria-label={t("page.game.backToLibrary")}
            title={t("page.game.backToLibrary")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              width="24"
              height="24"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>{t("common.back")}</span>
          </button>

          <div className="bigscreen-gamepage-hero-info">
          {resolvedLogo && !logoError ? (
            <img
              src={resolvedLogo}
              alt={game.name}
              className="bigscreen-gamepage-hero-logo"
              width={480}
              height={140}
              onError={() => setLogoError(true)}
            />
          ) : (
            <h1 className="bigscreen-gamepage-hero-title">{game.name}</h1>
          )}
            <div className="bigscreen-gamepage-hero-subtitle-row">
              {game.developer && (
                <span className="bigscreen-gamepage-hero-subtitle">
                  {game.developer}
                </span>
              )}
              {releaseYear && (
                <span className="bigscreen-gamepage-hero-subtitle-dot" />
              )}
              {releaseYear && (
                <span className="bigscreen-gamepage-hero-subtitle">
                  {releaseYear}
                </span>
              )}
            </div>

            {/* Metatrip inline */}
            <BigScreenMetaStrip
              aria-label="Game metadata"
              className="bigscreen-gamepage-meta-strip-inline"
            >
              <BigScreenPill tone="accent" size="sm">
                {game.platform}
              </BigScreenPill>
              <BigScreenPill
                tone="muted"
                size="sm"
                dot
                customColor={status.color}
              >
                {t(status.labelKey)}
              </BigScreenPill>
              <BigScreenPill
                tone="muted"
                size="sm"
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    width="12"
                    height="12"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                }
              >
                {game.playTime || "0h"}
              </BigScreenPill>
              {resolvedSteamAppId != null && (
                <BigScreenPill tone="muted" size="sm">
                  <PlayerCountBadge appId={resolvedSteamAppId} className="bigscreen-steam-players" /> on Steam
                </BigScreenPill>
              )}
              {rating != null && rating > 0 && (
                <BigScreenPill
                  tone="muted"
                  size="sm"
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                      width="12"
                      height="12"
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  }
                >
                  {Math.round(rating)}%{" "}
                  {game.igdbRating != null ? "IGDB" : "Critic"}
                </BigScreenPill>
              )}
              {game.installed ? (
                <BigScreenPill
                  tone="success"
                  size="sm"
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                      width="12"
                      height="12"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  }
                >
                {t("game.readyToPlay")}
              </BigScreenPill>
            ) : (
              <BigScreenPill tone="muted" size="sm">
                {t("game.notInstalled")}
              </BigScreenPill>
            )}
            {isRunning && (
              <BigScreenPill tone="success" size="sm" dot>
                {t("game.running")}
              </BigScreenPill>
            )}
            </BigScreenMetaStrip>
          </div>

          <BigScreenGameHeroActions
            isRunning={isRunning}
            isClosing={isClosing}
            showInstall={showInstall}
            hasPlayableTrailer={playableTrailer !== null}
            onPlay={handlePlay}
            onInstall={handleInstall}
            onForceClose={handleForceClose}
            onDownload={() => setDownloadOpen(true)}
            onTrailer={() => playableTrailer && setLightbox(playableTrailer)}
          />
        </div>
      </section>

      {/* ── Tab bar — the page's navigation spine (LB / RB) ──── */}
      <BigScreenTabBar
        tabs={tabs}
        activeTab={activeTab}
        onActivate={setActiveTab}
        onEnterContent={handleEnterTabContent}
        railId="game-hub-tabs"
        ariaLabel={t("bigscreen.tabbar.tabs")}
      />

      {/* ── Per-tab scroll region ───────────────────────────── */}
      <div className="bigscreen-gamepage-tab-scroll-region">
        <BigScreenTabPanel tabId="overview" activeTab={activeTab}>
          <BigScreenGamePageOverview game={game} />
        </BigScreenTabPanel>
        <BigScreenTabPanel tabId="media" activeTab={activeTab}>
          <BigScreenGamePageMedia
            game={game}
            onOpenLightbox={setLightbox}
            onFindDownload={() => setDownloadOpen(true)}
          />
        </BigScreenTabPanel>
        <BigScreenTabPanel tabId="specs" activeTab={activeTab}>
          <BigScreenGamePageSpecs game={game} />
        </BigScreenTabPanel>
        {resolvedSteamAppId != null && (
          <BigScreenTabPanel tabId="achievements" activeTab={activeTab}>
            <div className="bigscreen-gamepage-more">
              <AchievementsTab game={game} />
            </div>
          </BigScreenTabPanel>
        )}
        <BigScreenTabPanel tabId="reviews" activeTab={activeTab}>
          <div className="bigscreen-gamepage-more">
            <ReviewsTab game={game} />
          </div>
        </BigScreenTabPanel>
        <BigScreenTabPanel tabId="activity" activeTab={activeTab}>
          <div className="bigscreen-gamepage-more">
            <GameActivityTab game={game} />
          </div>
        </BigScreenTabPanel>
        <BigScreenTabPanel tabId="more" activeTab={activeTab}>
          <BigScreenGamePageMore game={game} />
        </BigScreenTabPanel>
      </div>

      {/* ── Download finder (portal-less, page level) ───────── */}
      {downloadOpen && (
        <DownloadModal
          gameName={game.name}
          gameId={game.id}
          gamePoster={game.coverSourceUrl ?? game.bannerUrl ?? game.coverArtUrl}
          steamAppId={game.steamAppId}
          onClose={() => setDownloadOpen(false)}
        />
      )}

      {/* ── Lightbox (portal-rendered) ──────────────────────── */}
      <BigScreenLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

// ─── Not found ───────────────────────────────────────────────────
// Stale /library/:gameId URLs render a lightweight empty state with
// a focusable "Go Back" action; controller B also routes back to the
// library grid.

function BigScreenGameNotFound({ onBack }: { onBack: () => void }) {
  const { t } = useLanguage();
  const gamepad = useGamepad();
  const backProps = useFocusable(onBack);

  useEffect(() => {
    return gamepad.registerBackHandler(onBack, 0);
  }, [gamepad.registerBackHandler, onBack]);

  return (
    <div
      className="bigscreen-gamepage"
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="bigscreen-library-empty-state"
        style={{ width: "100%", maxWidth: 480 }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          width="64"
          height="64"
          opacity="0.3"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <h3>{t("bigscreen.gameHub.gameNotFound")}</h3>
        <button
          type="button"
          className="bigscreen-gamepage-back-btn"
          {...backProps}
        >
          {t("bigscreen.gameHub.goBack")}
        </button>
      </div>
    </div>
  );
}

// ─── Overview tab content ────────────────────────────────────────
//
// The cinematic landing tab: narrative prose (storyline + about) on
// the left, a dense Playnite-style metadata rail on the right. The
// rail surfaces the facts users want at a glance (stats, ratings,
// genres, time-to-beat, developer/publisher, languages) so the data
// no longer has to be dug out of the Specs tab. Screenshots live in
// Media, deep-dive facts (system requirements, releases, crackwatch)
// stay in Specs.
//
// Only genuinely actionable things are focus stops here (the About
// expand/collapse toggle, the time-to-beat detail sheet). The rail
// blocks are read-only, so they render plainly — a focus ring on a
// card that does nothing is worse than no stop at all.

// Read-only block inside a tab body. Purely a layout slot.
function BigScreenBlock({ children }: { children: ReactNode }) {
  return <div className="bigscreen-gamepage-block">{children}</div>;
}

function BigScreenGamePageOverview({ game }: { game: Game }) {
  return (
    <div className="bigscreen-gamepage-overview">
      <div className="bigscreen-gamepage-overview-layout">
        <div className="bigscreen-gamepage-overview-prose">
          <BigScreenBlock>
            <StorylineSection game={game} />
          </BigScreenBlock>
          <AboutSection game={game} />
        </div>
        <BigScreenGamePageRail game={game} />
      </div>
    </div>
  );
}

// ─── Overview metadata rail ─────────────────────────────────────────
//
// The right-hand column of the Overview tab, modeled on Playnite's
// desktop Details view + Vapour's fullscreen metadata panel. Blocks
// render only when their data is present:
//   • 2×2 quick stats  (Playtime / Status / Last played / Released)
//   • Steam achievement progress  (rounded bar + recent unlocks)
//   • IGDB + critic ratings
//   • Genres chips
//   • Time-to-beat
//   • Developer / Publisher / Franchise / Collection rows
//   • Supported languages

function BigScreenGamePageRail({ game }: { game: Game }) {
  const { t } = useLanguage();
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];

  // Steam-synced achievement snapshot (the same source the desktop
  // hero uses for its progress ring).
  const achievements = game.steamAchievements;
  const achUnlocked = achievements?.filter((a) => a.achieved).length ?? 0;
  const achTotal = achievements?.length ?? 0;
  const achPct = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : null;
  const recentUnlocks = achievements
    ? [...achievements]
        .filter((a) => a.achieved && a.unlocktime > 0)
        .sort((a, b) => b.unlocktime - a.unlocktime)
        .slice(0, 3)
    : [];

  const hasTimeToBeat = (() => {
    const ttb = game.timeToBeat;
    return (
      !!ttb &&
      ((ttb.normally ?? 0) > 0 ||
        (ttb.completely ?? 0) > 0 ||
        (ttb.hastily ?? 0) > 0)
    );
  })();

  const hasAnyIdentity =
    !!game.developer ||
    !!game.publisher ||
    !!game.franchise ||
    !!game.collection;

  return (
    <aside
      className="bigscreen-gamepage-rail"
      aria-label={t("bigscreen.overview.rail")}
    >
      {/* ── 2×2 quick stats ─────────────────────────────────── */}
      <div className="bigscreen-gamepage-rail-grid">
        <div className="bigscreen-rail-stat">
          <span className="bigscreen-rail-stat__label">{t("hero.playTime")}</span>
          <span className="bigscreen-rail-stat__value">
            {game.playTime || "0h"}
          </span>
        </div>
        <div className="bigscreen-rail-stat">
          <span className="bigscreen-rail-stat__label">{t("hero.status")}</span>
          <span className="bigscreen-rail-stat__value bigscreen-rail-stat__value--row">
            <span
              className="bigscreen-rail-stat__dot"
              style={{
                background: status.color,
                boxShadow: `0 0 8px ${status.color}`,
              }}
            />
            {t(status.labelKey)}
          </span>
        </div>
        {game.lastPlayed ? (
          <div className="bigscreen-rail-stat">
            <span className="bigscreen-rail-stat__label">
              {t("game.lastPlayed")}
            </span>
            <span className="bigscreen-rail-stat__value">
              {formatLastPlayed(game.lastPlayed)}
            </span>
          </div>
        ) : null}
        {game.releaseDate ? (
          <div className="bigscreen-rail-stat">
            <span className="bigscreen-rail-stat__label">
              {t("gameInfo.releaseDate")}
            </span>
            <span className="bigscreen-rail-stat__value">
              {formatRailDate(game.releaseDate)}
            </span>
          </div>
        ) : null}
      </div>

      {/* ── Achievement progress ────────────────────────────── */}
      {achTotal > 0 && achPct != null && (
        <BigScreenBlock>
          <div className="bigscreen-rail-card bigscreen-rail-ach">
            <div className="bigscreen-rail-card__head">
              <span className="bigscreen-rail-card__title">
                <AchievementsIcon />
                {t("achievementsPage.achievements")}
              </span>
              <span className="bigscreen-rail-card__badge">
                {achUnlocked} / {achTotal}
              </span>
            </div>
            <div
              className="bigscreen-rail-ach__bar"
              role="progressbar"
              aria-valuenow={achPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("bigscreen.gameHub.achievements", {
                unlocked: achUnlocked,
                total: achTotal,
                pct: achPct,
              })}
            >
              <div
                className="bigscreen-rail-ach__fill"
                style={{ width: `${achPct}%` }}
              />
            </div>
            <div className="bigscreen-rail-ach__meta">
              <span className="bigscreen-rail-ach__pct">{achPct}%</span>
              <span className="bigscreen-rail-ach__count">
                {achUnlocked} {t("achievements.unlocked").toLowerCase()}
              </span>
            </div>
            {recentUnlocks.length > 0 && (
              <div className="bigscreen-rail-ach__recent">
                <span className="bigscreen-rail-ach__recent-label">
                  {t("achievementsPage.recentUnlocks")}
                </span>
                {recentUnlocks.map((a) => (
                  <div className="bigscreen-rail-ach__recent-row" key={a.apiname}>
                    {a.icon ? (
                      <img
                        src={a.icon}
                        alt=""
                        className="bigscreen-rail-ach__icon"
                        loading="lazy"
                      />
                    ) : (
                      <span className="bigscreen-rail-ach__icon bigscreen-rail-ach__icon--fallback" />
                    )}
                    <span className="bigscreen-rail-ach__recent-name">
                      {a.name}
                    </span>
                    <time className="bigscreen-rail-ach__recent-date">
                      {formatAchDate(a.unlocktime)}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </div>
        </BigScreenBlock>
      )}

      {/* ── Ratings (IGDB + critics) ────────────────────────── */}
      {(game.igdbRating != null || game.criticRating != null) && (
        <BigScreenBlock>
          <RatingsKpiCard game={game} />
        </BigScreenBlock>
      )}

      {/* ── Genres ──────────────────────────────────────────── */}
      {game.genres && game.genres.length > 0 && (
        <BigScreenBlock>
          <div className="bigscreen-rail-card">
            <span className="bigscreen-rail-card__title">
              {t("bigscreen.overview.genres")}
            </span>
            <div className="bigscreen-rail-chips">
              {game.genres.map((g) => (
                <span className="bigscreen-rail-chip" key={g}>
                  {g}
                </span>
              ))}
            </div>
          </div>
        </BigScreenBlock>
      )}

      {/* ── Time to beat ────────────────────────────────────── */}
      {hasTimeToBeat && (
        <BigScreenBlock>
          <TimeToBeatCard game={game} />
        </BigScreenBlock>
      )}

      {/* ── Developer / Publisher / Franchise / Collection ──── */}
      {hasAnyIdentity && (
        <BigScreenBlock>
          <div className="bigscreen-rail-card bigscreen-rail-rows">
            {game.developer && (
              <BigScreenRailRow
                label={t("bigscreen.gameHub.developer")}
                value={game.developer}
              />
            )}
            {game.publisher && (
              <BigScreenRailRow
                label={t("bigscreen.gameHub.publisher")}
                value={game.publisher}
              />
            )}
            {game.franchise && (
              <BigScreenRailRow
                label={t("info.franchise")}
                value={game.franchise}
              />
            )}
            {game.collection && (
              <BigScreenRailRow
                label={t("bigscreen.overview.collection")}
                value={game.collection}
              />
            )}
          </div>
        </BigScreenBlock>
      )}

      {/* ── Supported languages ─────────────────────────────── */}
      {game.languageSupports && game.languageSupports.length > 0 && (
        <BigScreenBlock>
          <LanguagesSection game={game} />
        </BigScreenBlock>
      )}
    </aside>
  );
}

function BigScreenRailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bigscreen-rail-row">
      <span className="bigscreen-rail-row__label">{label}</span>
      <span className="bigscreen-rail-row__value" title={value}>
        {value}
      </span>
    </div>
  );
}

function formatRailDate(date: string | undefined): string {
  if (!date) return "";
  // IGDB dates arrive as ISO `YYYY-MM-DD`; Steam-sourced strings
  // (e.g. "Mar 21, 2024") pass through untouched.
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  return date;
}

function formatAchDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
}

// ─── Media tab content ────────────────────────────────────────────
//
// Screenshots and videos are wrapped in a `[data-rail-id]` scroller each,
// so Left/Right walks the strip and wraps at the ends. The carousel's own
// prev/next arrows are hidden here (see bigscreen.css): they were
// mouse-only decoration sitting next to cards the D-pad can already
// reach, and the rail is the real navigation.
//
// When a game has neither, the tab offers one real action instead of a
// dead end.

function BigScreenGamePageMedia({
  game,
  onOpenLightbox,
  onFindDownload,
}: {
  game: Game;
  onOpenLightbox: (src: string) => void;
  onFindDownload: () => void;
}) {
  const { t } = useLanguage();
  const hasScreenshots = game.screenshots && game.screenshots.length > 0;
  const hasVideos = game.videos && game.videos.length > 0;
  const downloadProps = useFocusable(onFindDownload);

  if (!hasScreenshots && !hasVideos) {
    return (
      <div className="bigscreen-gamepage-empty">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="64"
          height="64"
          aria-hidden
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <h3>{t("game.noMediaTitle")}</h3>
        <p>{t("game.noMediaSubtitle")}</p>
        {/* A real action, not a decorative focus stop: this is where a
            player with no screenshots can go looking for the game. */}
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--secondary"
          {...downloadProps}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{t("game.findDownload")}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="bigscreen-gamepage-media">
      {hasScreenshots && (
        <BigScreenRailScroller
          railId="game-hub-screenshots"
          label={t("community.tab.screenshots")}
        >
          <ScreenshotsSection game={game} onOpen={onOpenLightbox} />
        </BigScreenRailScroller>
      )}
      {hasVideos && (
        <BigScreenRailScroller
          railId="game-hub-videos"
          label={t("videos.title")}
        >
          <VideosSection game={game} />
        </BigScreenRailScroller>
      )}
    </div>
  );
}

// ─── Specs tab content ─────────────────────────────────────────────
//
// Power-user "data dump". After the Overview refactor moved the
// headline metadata (ratings, time-to-beat, languages) into the
// Overview's right-hand rail, Specs keeps the deep-dive facts:
// modes/themes/perspectives, releases, system requirements, and the
// crackwatch status.
//
// Nothing on this tab is interactive, so it is deliberately not a focus
// target: pressing Down keeps focus on the tab strip (the anchor the
// user came from) rather than dropping them on a card that does nothing.

function BigScreenGamePageSpecs({ game }: { game: Game }) {
  return (
    <div className="bigscreen-gamepage-specs">
      {/* Two-column: SpecsCard + ReleasesCard. */}
      <div className="bigscreen-gamepage-2col" data-cols="2">
        <BigScreenBlock>
          <SpecsCard game={game} />
        </BigScreenBlock>
        <BigScreenBlock>
          <ReleasesCard game={game} />
        </BigScreenBlock>
      </div>

      {/* System Requirements (Steam pc_requirements). Auto-hides
       *  when Steam has no appid for the title. */}
      <BigScreenBlock>
        <SystemRequirementsCard
          steamAppId={
            typeof game.steamAppId === "number" ? game.steamAppId : null
          }
        />
      </BigScreenBlock>

      {/* CrackWatch status (cracked / uncracked / denuvo). */}
      <BigScreenBlock>
        <CrackWatchCard gameName={game.name} appId={game.steamAppId} />
      </BigScreenBlock>
    </div>
  );
}

// ─── More tab content ────────────────────────────────────────────
//
// Reuses the desktop tab components (WebLinksTab, GameRelationsCard) so
// they don't fork. `WebLinksTab` accepts a `visible?: boolean` prop the
// desktop uses to suppress the embedded webview when modals are open;
// Big Screen has no modals on this tab so we pass `visible={true}`.
//
// The relations rail is the tab's focus landing, which is why it sits
// first — "explore further" is the reason to open this tab at all.

function BigScreenGamePageMore({ game }: { game: Game }) {
  return (
    <div className="bigscreen-gamepage-more">
      <GameRelationsCard
        mode="library"
        currentGame={game}
        currentGameId={game.id}
        similarGames={game.similarGames}
        collectionId={game.collectionId}
        collectionName={game.collection}
      />

      {/* External links (store, ProtonDB, PCGamingWiki, etc.).
       *  visible={true} — no Big Screen modal masking. */}
      <WebLinksTab game={game} visible={true} />
    </div>
  );
}

// ─── Tab icons (inline SVGs, no icon library dependency) ─────────

function OverviewIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function MediaIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function SpecsIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function MoreIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function AchievementsIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34" />
      <path d="M12 2a5 5 0 0 0-5 5v3c0 2.76 2.24 5 5 5s5-2.24 5-5V7a5 5 0 0 0-5-5z" />
    </svg>
  );
}

function ReviewsIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ActivityIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
