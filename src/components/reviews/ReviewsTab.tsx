import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useBigScreen } from "../../context/BigScreenContext";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import {
  type Game,
  type IgdbReview,
  type ReviewFetchResult,
  extractSteamAppId,
  resolveSteamAppId,
} from "../../types/game";
import {
  type DisplayOrder,
  type ExternalSourceDescriptor,
  type PlaytimeDeviceFilter,
  type PlaytimePresetFilter,
  type PurchaseTypeFilter,
  type ReviewItem,
  type ReviewTypeFilter,
  type ReviewsTabProps,
  type SourceFilter,
} from "./types";
import { ReviewSummaryHero } from "./ReviewSummaryHero";
import { ReviewRow } from "./ReviewRow";
import { CriticReviewRow } from "./CriticReviewRow";
import { ReviewsToolbar } from "./ReviewsToolbar";
import { ReviewsExternalShowcase } from "./ReviewsExternalShowcase";
import { ReviewsEmptyState } from "./ReviewsEmptyState";

function ratingToSentiment(score: number | null): "positive" | "negative" | null {
  if (score === null) return null;
  if (score >= 60) return "positive";
  return "negative";
}

function buildExternalUrl(game: Game, site: "metacritic" | "opencritic"): string {
  const q = encodeURIComponent(game.name);
  switch (site) {
    case "metacritic":
      return `https://www.metacritic.com/search/game/${q}/results`;
    case "opencritic":
      return `https://opencritic.com/search?criteria=${q}`;
  }
}

function getSteamCommunityUrl(path: string): string | null {
  const id = extractSteamAppId(path);
  if (id === null) return null;
  return `https://steamcommunity.com/app/${id}/reviews/?browsefilter=toprated`;
}

export default function ReviewsTab({ game, onReviewsFetched }: ReviewsTabProps) {
  const { isBigScreen } = useBigScreen();
  const { showToast } = useToast();
  const { updateGame } = useGames();
  const { t } = useLanguage();

  // ── Filters State ──────────────────────────────────────────────────────────
  const [display, setDisplay] = useState<DisplayOrder>("all");
  const [reviewType, setReviewType] = useState<ReviewTypeFilter>("all");
  const [purchaseType, setPurchaseType] = useState<PurchaseTypeFilter>("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [playtimePreset, setPlaytimePreset] = useState<PlaytimePresetFilter>("none");
  const [playtimeMinHours, setPlaytimeMinHours] = useState(0);
  const [playtimeMaxHours, setPlaytimeMaxHours] = useState(0);
  const [playtimeDevice, setPlaytimeDevice] = useState<PlaytimeDeviceFilter>("all");
  const [useHelpfulSystem, setUseHelpfulSystem] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const queryKey = useMemo(
    () =>
      JSON.stringify({
        d: display,
        rt: reviewType,
        pt: purchaseType,
        l: languageFilter,
        pp: playtimePreset,
        pmin: playtimeMinHours,
        pmax: playtimeMaxHours,
        pd: playtimeDevice,
        uhs: useHelpfulSystem,
      }),
    [
      display,
      reviewType,
      purchaseType,
      languageFilter,
      playtimePreset,
      playtimeMinHours,
      playtimeMaxHours,
      playtimeDevice,
      useHelpfulSystem,
    ],
  );

  // ── Steam Review Data ──────────────────────────────────────────────────────
  const [isFetchingReviews, setIsFetchingReviews] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [steamReviewScoreDesc, setSteamReviewScoreDesc] = useState<string | null>(null);
  const [steamReviewScore, setSteamReviewScore] = useState<number | null>(null);
  const [steamTotalPositive, setSteamTotalPositive] = useState<number | null>(null);
  const [steamTotalNegative, setSteamTotalNegative] = useState<number | null>(null);

  const autoFetchedForRef = useRef<string | null>(null);
  const fetchInFlightRef = useRef(false);
  const currentFetchGameIdRef = useRef<string>(game.id);
  const reviewsListRef = useRef<IgdbReview[]>([]);

  const [reviewsList, setReviewsList] = useState<IgdbReview[]>([]);
  useEffect(() => {
    setReviewsList(game.igdbReviews ?? []);
    reviewsListRef.current = game.igdbReviews ?? [];
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reviewsListRef.current = reviewsList;
  }, [reviewsList]);

  // ── External Critic Reviews (Metacritic, OpenCritic) ──────────────────────
  const externalReviewsRef = useRef<Record<string, IgdbReview[]>>({});
  const [externalReviews, setExternalReviews] = useState<Record<string, IgdbReview[]>>({});
  const [externalLoading, setExternalLoading] = useState<Record<string, boolean>>({
    metacritic: false,
    opencritic: false,
  });
  const externalFetchedRef = useRef<Set<string>>(new Set());

  const fetchExternalReviews = useCallback(
    async (src: string) => {
      if (externalFetchedRef.current.has(src)) return;
      externalFetchedRef.current.add(src);
      setExternalLoading((prev) => ({ ...prev, [src]: true }));
      try {
        const reviews = await invoke<IgdbReview[]>("fetch_external_reviews", {
          gameName: game.name,
          source: src,
        });
        externalReviewsRef.current = { ...externalReviewsRef.current, [src]: reviews };
        setExternalReviews((prev) => ({ ...prev, [src]: reviews }));
        if (reviews.length > 0) {
          const labels: Record<string, string> = {
            metacritic: "Metacritic",
            opencritic: "OpenCritic",
          };
          showToast(
            `Fetched ${reviews.length} review${reviews.length === 1 ? "" : "s"} from ${labels[src] || src}`,
            "success",
          );
        }
      } catch (err) {
        console.error(`Failed to fetch ${src} reviews:`, err);
        externalFetchedRef.current.delete(src);
      } finally {
        setExternalLoading((prev) => ({ ...prev, [src]: false }));
      }
    },
    [game.name, showToast],
  );

  useEffect(() => {
    externalReviewsRef.current = {};
    setExternalReviews({});
    setExternalLoading({ metacritic: false, opencritic: false });
    externalFetchedRef.current = new Set();
    // Proactively fetch Metacritic reviews so they are immediately available in All view and counts
    void fetchExternalReviews("metacritic");
  }, [game.id, fetchExternalReviews]);

  useEffect(() => {
    if (sourceFilter === "metacritic" || sourceFilter === "opencritic") {
      void fetchExternalReviews(sourceFilter);
    }
  }, [sourceFilter, game.id, fetchExternalReviews]);

  // ── Fetch Steam Reviews ────────────────────────────────────────────────────
  const fetchReviews = useCallback(
    async (force = false, cursor: string | null = null, currentLang: string = languageFilter) => {
      if (fetchInFlightRef.current) return;
      const targetGameId = game.id;
      fetchInFlightRef.current = true;
      const acquiredLock = true;
      const isLoadMore = cursor !== null && cursor !== "";

      if (isLoadMore) setIsLoadingMore(true);
      else setIsFetchingReviews(true);

      try {
        const steamHint = resolveSteamAppId(game);
        const result = await invoke<ReviewFetchResult>("fetch_game_reviews", {
          gameName: game.name,
          steamAppId: steamHint,
          cursor: cursor || null,
          language: currentLang === "all" ? null : currentLang,
          filterType: display === "summary" ? "summary" : display,
          purchaseType: purchaseType === "all" ? null : purchaseType,
          playtimeMinHours:
            playtimePreset === "over_1h"
              ? 1
              : playtimePreset === "over_10h"
              ? 10
              : playtimePreset === "custom"
              ? playtimeMinHours
              : null,
          playtimeMaxHours: playtimePreset === "custom" ? playtimeMaxHours : null,
          reviewType: reviewType === "all" ? null : reviewType,
          playtimeDevice: playtimeDevice === "all" ? null : playtimeDevice,
          useHelpfulSystem: useHelpfulSystem || null,
        });

        if (targetGameId !== currentFetchGameIdRef.current) return;

        if (!isLoadMore) {
          setTotalReviewCount(result.totalReviews ?? 0);
          setSteamReviewScoreDesc(result.steamReviewScoreDesc ?? null);
          setSteamReviewScore(result.steamReviewScore ?? null);
          setSteamTotalPositive(result.steamTotalPositive ?? null);
          setSteamTotalNegative(result.steamTotalNegative ?? null);
        }

        if (result.cursor && result.cursor !== cursor && result.cursor !== "*") {
          setNextCursor(result.cursor);
        } else {
          setNextCursor(null);
        }

        if (result.reviews && result.reviews.length > 0) {
          const seen = new Set<string>();
          const next: IgdbReview[] = [];

          if (isLoadMore) {
            for (const r of reviewsListRef.current) {
              const key = `${r.username || ""}_${r.timestampCreated || ""}_${(r.content || "").slice(0, 40)}`;
              if (!seen.has(key)) {
                seen.add(key);
                next.push(r);
              }
            }
          }

          for (const r of result.reviews) {
            const key = `${r.username || ""}_${r.timestampCreated || ""}_${(r.content || "").slice(0, 40)}`;
            if (!seen.has(key)) {
              seen.add(key);
              next.push(r);
            }
          }

          setReviewsList(next);
          reviewsListRef.current = next;
          updateGame(game.id, { igdbReviews: next });
          onReviewsFetched?.(next, result.source);

          if (isLoadMore) {
            showToast(
              `Loaded ${result.reviews.length} more reviews (${next.length} total)`,
              "success",
            );
          } else if (force) {
            const sourceLabel =
              result.source === "steam"
                ? "Steam"
                : result.source === "igdb"
                ? "IGDB"
                : "community";
            showToast(
              `Fetched ${result.reviews.length} review${result.reviews.length === 1 ? "" : "s"} from ${sourceLabel}`,
              "success",
            );
          }
        } else if (isLoadMore) {
          setNextCursor(null);
          showToast("No more reviews available", "info");
        } else if (force) {
          showToast("No reviews available from any source", "info");
        }
      } catch (err) {
        console.error("Auto-fetch reviews failed:", err);
        if (force || isLoadMore) {
          showToast(`Failed to fetch reviews: ${err}`, "error");
        }
      } finally {
        if (acquiredLock && targetGameId === currentFetchGameIdRef.current) {
          fetchInFlightRef.current = false;
          setIsFetchingReviews(false);
          setIsLoadingMore(false);
        }
      }
    },
    [
      game.id,
      game.name,
      game.path,
      game.platform,
      game.steamAppId,
      showToast,
      updateGame,
      onReviewsFetched,
      languageFilter,
      display,
      purchaseType,
      playtimePreset,
      playtimeMinHours,
      playtimeMaxHours,
      reviewType,
      playtimeDevice,
      useHelpfulSystem,
    ],
  );

  // Auto-fetch on game selection change
  useEffect(() => {
    if (autoFetchedForRef.current === game.id) return;
    autoFetchedForRef.current = game.id;
    currentFetchGameIdRef.current = game.id;
    fetchInFlightRef.current = false;
    setNextCursor(null);

    if (game.igdbReviews && game.igdbReviews.length > 0) {
      setReviewsList(game.igdbReviews);
      reviewsListRef.current = game.igdbReviews;
      setTotalReviewCount(0);
      setSteamReviewScoreDesc(null);
      setSteamReviewScore(null);
      setSteamTotalPositive(null);
      setSteamTotalNegative(null);
    } else {
      setReviewsList([]);
      reviewsListRef.current = [];
      setTotalReviewCount(0);
      setSteamReviewScoreDesc(null);
      setSteamReviewScore(null);
      setSteamTotalPositive(null);
      setSteamTotalNegative(null);
    }
    void fetchReviews(false, null, "all");
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch when server query parameters change
  const queryKeyRef = useRef(queryKey);
  useEffect(() => {
    if (queryKeyRef.current === queryKey) return;
    queryKeyRef.current = queryKey;
    setNextCursor(null);
    void fetchReviews(true, null, languageFilter);
  }, [queryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build Unified Reviews List ─────────────────────────────────────────────
  const allReviews: ReviewItem[] = useMemo(() => {
    const items: ReviewItem[] = [];

    // 1. Steam / Cached reviews
    if (reviewsList.length > 0) {
      reviewsList.forEach((r: IgdbReview, idx: number) => {
        const content = r.content || "";
        items.push({
          id: `steam-${idx}`,
          sourceIndex: idx,
          source: "steam",
          sourceLabel: "Steam",
          username: r.username || `Steam Player`,
          rating: r.rating ?? null,
          ratingLabel: r.rating !== undefined ? `${r.rating}/100` : "—",
          title: r.title || "",
          content,
          dateAdded: r.timestampCreated ? r.timestampCreated * 1000 : undefined,
          reviewLength: content.length,
          reviewLengthBytes: new Blob([content]).size,
          language: r.language,
          sentiment: ratingToSentiment(r.rating ?? null),
          votesUp: r.votesUp,
          votesFunny: r.votesFunny,
          reactions: r.reactions,
          commentCount: r.commentCount,
          authorPlaytimeAtReview: r.authorPlaytimeAtReview,
          authorPlaytimeForever: r.authorPlaytimeForever,
          authorDeckPlaytimeAtReview: r.authorDeckPlaytimeAtReview,
          primarilySteamDeck: r.primarilySteamDeck,
          receivedForFree: r.receivedForFree,
          writtenDuringEarlyAccess: r.writtenDuringEarlyAccess,
          steamPurchase: r.steamPurchase,
          authorSteamId: r.authorSteamId,
          hw: r.hw,
        });
      });
    }

    // 2. External Critic reviews (Metacritic, OpenCritic)
    const externalLabels: Record<string, string> = {
      metacritic: "Metacritic",
      opencritic: "OpenCritic",
    };

    let externalIdx = items.length;
    for (const [src, label] of Object.entries(externalLabels)) {
      const revs = externalReviews[src];
      if (revs && revs.length > 0) {
        revs.forEach((r: IgdbReview) => {
          const content = r.content || "";
          items.push({
            id: `${src}-${externalIdx++}`,
            sourceIndex: externalIdx,
            source: src as ReviewItem["source"],
            sourceLabel: label,
            username: r.username || label,
            rating: r.rating ?? null,
            ratingLabel: r.rating !== undefined ? `${Math.round(r.rating)}/100` : "—",
            title: r.title || "",
            content,
            dateAdded: r.timestampCreated ? r.timestampCreated * 1000 : undefined,
            reviewLength: content.length,
            reviewLengthBytes: new Blob([content]).size,
            language: r.language,
            sentiment: ratingToSentiment(r.rating ?? null),
          });
        });
      }
    }

    return items;
  }, [reviewsList, externalReviews]);

  // ── Client-side Filter Pass ────────────────────────────────────────────────
  const filteredReviews = useMemo(() => {
    let list = allReviews.slice();

    if (sourceFilter !== "all") {
      list = list.filter((r) => r.source === sourceFilter);
    }
    if (languageFilter !== "all") {
      list = list.filter((r) => r.language === languageFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.content.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.username.toLowerCase().includes(q),
      );
    }

    list.sort((a, b) => a.sourceIndex - b.sourceIndex);
    return list;
  }, [allReviews, sourceFilter, languageFilter, searchQuery]);

  // ── External Critic Showcase Sources ───────────────────────────────────────
  const externalSources: ExternalSourceDescriptor[] = useMemo(() => {
    const sources: ExternalSourceDescriptor[] = [];
    if (game.metadataUrl && game.metadataSource) {
      sources.push({
        id: "metadata",
        name: game.metadataSource,
        url: game.metadataUrl,
        description: `View on ${game.metadataSource}`,
        accent: "var(--color-accent)",
      });
    }
    if (game.platform === "Steam") {
      const community = getSteamCommunityUrl(game.path);
      if (community) {
        sources.push({
          id: "steam-reviews",
          name: "Steam Reviews",
          url: community,
          description: "Read Steam community reviews",
          accent: "#1b9ae0",
        });
      }
    }
    sources.push(
      {
        id: "metacritic",
        name: "Metacritic",
        url: buildExternalUrl(game, "metacritic"),
        description: `Search “${game.name}” on Metacritic`,
        accent: "#ffcc33",
        criticKey: "metacritic",
      },
      {
        id: "opencritic",
        name: "OpenCritic",
        url: buildExternalUrl(game, "opencritic"),
        description: `Search “${game.name}” on OpenCritic`,
        accent: "#ff5722",
        criticKey: "opencritic",
      },
    );
    return sources;
  }, [game.metadataUrl, game.metadataSource, game.platform, game.path, game.name]);

  const steamCount =
    totalReviewCount > 0 ? totalReviewCount : allReviews.filter((r) => r.source === "steam").length;
  const metacriticCount = externalReviews.metacritic?.length ?? 0;
  const opencriticCount = externalReviews.opencritic?.length ?? 0;
  const totalCritics = metacriticCount + opencriticCount;
  const totalAll = steamCount + totalCritics;
  const appId = resolveSteamAppId(game);

  const criticCounts = useMemo(
    () => ({
      metacritic: externalReviews.metacritic?.length ?? 0,
      opencritic: externalReviews.opencritic?.length ?? 0,
    }),
    [externalReviews],
  );

  const criticLabels: Record<string, string> = {
    metacritic: "Metacritic",
    opencritic: "OpenCritic",
  };

  const isCriticSource =
    sourceFilter === "metacritic" || sourceFilter === "opencritic";

  function openExternal(url: string) {
    openUrl(url).catch((err) => {
      showToast(`Could not open link: ${err}`, "error");
    });
  }

  const handleResetFilters = () => {
    setReviewType("all");
    setPurchaseType("all");
    setLanguageFilter("all");
    setPlaytimePreset("none");
    setPlaytimeMinHours(0);
    setPlaytimeMaxHours(0);
    setPlaytimeDevice("all");
    setUseHelpfulSystem(false);
    setSearchQuery("");
  };

  return (
    <div className="rv-root">
      {/* ── Header ── */}
      <header className="rv-header">
        <div className="rv-header-left">
          <span className="rv-header-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <line x1="9" y1="10" x2="15" y2="10" />
              <line x1="12" y1="13" x2="12" y2="13" />
            </svg>
          </span>
          <div className="rv-header-text">
            <h2 className="rv-header-title">{t("review.communityReviews")}</h2>
            <p className="rv-header-subtitle">
              {totalAll > 0
                ? t("review.subtitleCount", { count: totalAll.toLocaleString() })
                : totalAll === 0
                ? t("review.subtitleNone")
                : t("review.subtitleOne")}
            </p>
          </div>
        </div>

        <div className="rv-header-actions">
          <button
            type="button"
            className="rv-refresh-btn"
            onClick={() => {
              setNextCursor(null);
              void fetchReviews(true, null);
            }}
            disabled={isFetchingReviews}
            title="Fetch latest reviews from Steam"
            aria-label="Refresh reviews"
          >
            {isFetchingReviews ? (
              <>
                <span className="rv-spinner" aria-hidden="true" />
                {t("review.fetchingReviews")}
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                {t("review.refreshReviews")}
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Summary Hero Dashboard ── */}
      {!isCriticSource && (
        <ReviewSummaryHero
          reviews={allReviews}
          totalReviewCount={totalAll}
          steamReviewScoreDesc={steamReviewScoreDesc}
          steamReviewScore={steamReviewScore}
          steamTotalPositive={steamTotalPositive}
          steamTotalNegative={steamTotalNegative}
          onFilterSentiment={(s) => setReviewType(s)}
          activeSentimentFilter={reviewType}
        />
      )}

      {/* ── Toolbar & Segmented Sources ── */}
      <ReviewsToolbar
        display={display}
        onDisplayChange={setDisplay}
        reviewType={reviewType}
        onReviewTypeChange={setReviewType}
        purchaseType={purchaseType}
        onPurchaseTypeChange={setPurchaseType}
        languageFilter={languageFilter}
        onLanguageFilterChange={setLanguageFilter}
        playtimePreset={playtimePreset}
        onPlaytimePresetChange={setPlaytimePreset}
        playtimeMinHours={playtimeMinHours}
        onPlaytimeMinHoursChange={setPlaytimeMinHours}
        playtimeMaxHours={playtimeMaxHours}
        onPlaytimeMaxHoursChange={setPlaytimeMaxHours}
        playtimeDevice={playtimeDevice}
        onPlaytimeDeviceChange={setPlaytimeDevice}
        useHelpfulSystem={useHelpfulSystem}
        onUseHelpfulSystemChange={setUseHelpfulSystem}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        totalAll={totalAll}
        steamCount={steamCount}
        criticCounts={criticCounts}
        criticLoading={externalLoading as { metacritic: boolean; opencritic: boolean }}
        matchCount={searchQuery.trim() ? filteredReviews.length : undefined}
        onResetFilters={handleResetFilters}
      />

      {/* ── Review Content Feed ── */}
      {isCriticSource && externalLoading[sourceFilter] ? (
        <ReviewsEmptyState
          type="critic-loading"
          criticSource={sourceFilter}
          criticLabel={criticLabels[sourceFilter]}
        />
      ) : isCriticSource && (externalReviews[sourceFilter]?.length ?? 0) === 0 ? (
        <ReviewsEmptyState
          type="critic-empty"
          criticSource={sourceFilter}
          criticLabel={criticLabels[sourceFilter]}
          onOpenExternalCritic={() =>
            openExternal(buildExternalUrl(game, sourceFilter as "metacritic" | "opencritic"))
          }
        />
      ) : totalAll === 0 ? (
        <ReviewsEmptyState type="empty-all" />
      ) : filteredReviews.length === 0 ? (
        <ReviewsEmptyState type="no-matches" onResetFilters={handleResetFilters} />
      ) : (
        <div className="rv-list">
          <div className="rv-list-rows">
            {filteredReviews.map((review) =>
              review.source === "metacritic" ||
              review.source === "opencritic" ? (
                <CriticReviewRow
                  key={review.id}
                  review={review}
                  searchQuery={searchQuery}
                />
              ) : (
                <ReviewRow
                  key={review.id}
                  review={review}
                  appId={appId}
                  searchQuery={searchQuery}
                />
              ),
            )}
          </div>

          {nextCursor && !isCriticSource && (
            <div className="rv-load-more-row">
              <button
                type="button"
                className="rv-btn rv-btn-ghost rv-btn-large"
                onClick={() => void fetchReviews(false, nextCursor, languageFilter)}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <>
                    <span className="rv-spinner" aria-hidden="true" />
                    {t("review.loadingMore")}
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <polyline points="19 12 12 19 5 12" />
                    </svg>
                    {t("review.loadMoreReviews")}
                    {totalReviewCount > 0 && (
                      <span className="rv-load-more-count">
                        {t("review.loadedCount", {
                          loaded: reviewsList.length,
                          total: totalReviewCount,
                        })}
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Critics Across the Web Showcase ── */}
      <ReviewsExternalShowcase
        sources={externalSources}
        openExternal={openExternal}
        isBigScreen={isBigScreen}
        criticCounts={criticCounts}
        onShowInApp={(src) => setSourceFilter(src)}
      />
    </div>
  );
}
