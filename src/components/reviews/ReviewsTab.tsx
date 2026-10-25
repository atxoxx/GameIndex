import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bookmark,
  MessageSquare,
  Newspaper,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { useBigScreen } from "../../context/BigScreenContext";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { usePersistedState } from "../../hooks/usePersistedState";
import { useSettings } from "../../context/SettingsContext";
import { Button } from "../ui";
import {
  GameTabChips,
  GameTabEmpty,
  GameTabSearch,
  GameTabSkeleton,
  GameTabToolbar,
  useGameTabState,
} from "../game/tabs";
import {
  type Game,
  type IgdbReview,
  type ReviewFetchResult,
  STEAM_LANGUAGES,
  gameDisplayName,
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
  type ReviewsTabProps,
} from "./types";
import { ReviewSummaryHero } from "./ReviewSummaryHero";
import { ReviewRow } from "./ReviewRow";
import { CriticReviewRow } from "./CriticReviewRow";
import { ReviewsExternalShowcase } from "./ReviewsExternalShowcase";
import { ReviewsEmptyState } from "./ReviewsEmptyState";
import ReviewsSavedQuotes from "./ReviewsSavedQuotes";
import ReviewsFilterPopover from "./ReviewsFilterPopover";
import { useReviewQuotes } from "./useReviewQuotes";
import { excerptDraft, reviewDraft, reviewKeyOf } from "./reviewQuoteUtils";

const REVIEW_SOURCE_ACCENTS = {
  "--review-source-steam": "#1b9ae0",
  "--review-source-metacritic": "#ffcc33",
  "--review-source-opencritic": "#ff5722",
} as const;

const LANGUAGE_FILTERS = ["all", ...STEAM_LANGUAGES.map((language) => language.code)];

type ReviewsView = "community" | "critics" | "saved";
type CriticSource = "all" | "metacritic" | "opencritic";

interface ReviewsTabState {
  view: ReviewsView;
  source: CriticSource;
  sentiment: "all" | "positive" | "negative";
}

const DEFAULT_STATE: ReviewsTabState = {
  view: "community",
  source: "all",
  sentiment: "all",
};

function ratingToSentiment(score: number | null): "positive" | "negative" | null {
  if (score === null) return null;
  return score >= 60 ? "positive" : "negative";
}

function buildExternalUrl(game: Game, site: "metacritic" | "opencritic"): string {
  const query = encodeURIComponent(game.name);
  return site === "metacritic"
    ? `https://www.metacritic.com/search/game/${query}/results`
    : `https://opencritic.com/search?criteria=${query}`;
}

function getSteamCommunityUrl(path: string): string | null {
  const id = extractSteamAppId(path);
  return id === null ? null : `https://steamcommunity.com/app/${id}/reviews/?browsefilter=toprated`;
}

/**
 * Reviews — a summary rail beside a feed.
 *
 * The rail holds the score board, sentiment distribution and the three
 * surfaces (community / critics / saved quotes). The feed carries one reading
 * column with search, a filter popover and, for community reviews, endless
 * paging. Bookmarks and highlighted excerpts are durable user state.
 */
export default function ReviewsTab({ game, onReviewsFetched }: ReviewsTabProps) {
  const { isBigScreen } = useBigScreen();
  const { showToast } = useToast();
  const { updateGame } = useGames();
  const { t } = useLanguage();
  const { showDeckVerified } = useSettings();

  const [state, setState] = useGameTabState<ReviewsTabState>({
    prefix: "rv",
    defaults: DEFAULT_STATE,
    allowed: {
      view: ["community", "critics", "saved"],
      source: ["all", "metacritic", "opencritic"],
      sentiment: ["all", "positive", "negative"],
    },
  });

  const [display, setDisplay] = usePersistedState<DisplayOrder>(
    "gamelib.reviews.display_v1",
    "all",
    ["summary", "all", "recent", "funny"],
  );
  const [purchaseType, setPurchaseType] = usePersistedState<PurchaseTypeFilter>(
    "gamelib.reviews.purchase_v1",
    "all",
    ["all", "steam", "other"],
  );
  const [languageFilter, setLanguageFilter] = usePersistedState<string>(
    "gamelib.reviews.language_v1",
    "all",
    LANGUAGE_FILTERS,
  );
  const [playtimePreset, setPlaytimePreset] = usePersistedState<PlaytimePresetFilter>(
    "gamelib.reviews.playtime_v1",
    "none",
    ["none", "over_1h", "over_10h", "custom"],
  );
  const [playtimeDevice, setPlaytimeDevice] = usePersistedState<PlaytimeDeviceFilter>(
    "gamelib.reviews.device_v1",
    "all",
    ["all", "deck"],
  );
  const [helpfulnessRaw, setHelpfulnessRaw] = usePersistedState(
    "gamelib.reviews.helpful_v1",
    "0",
    ["0", "1"],
  );
  const useHelpfulSystem = helpfulnessRaw === "1";

  const [playtimeMinHours, setPlaytimeMinHours] = useState(0);
  const [playtimeMaxHours, setPlaytimeMaxHours] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [isFetchingReviews, setIsFetchingReviews] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [steamReviewScoreDesc, setSteamReviewScoreDesc] = useState<string | null>(null);
  const [steamReviewScore, setSteamReviewScore] = useState<number | null>(null);
  const [steamTotalPositive, setSteamTotalPositive] = useState<number | null>(null);
  const [steamTotalNegative, setSteamTotalNegative] = useState<number | null>(null);
  const [reviewsList, setReviewsList] = useState<IgdbReview[]>([]);

  const autoFetchedForRef = useRef<string | null>(null);
  const fetchInFlightRef = useRef(false);
  const currentFetchGameIdRef = useRef<string>(game.id);
  const reviewsListRef = useRef<IgdbReview[]>([]);
  const quoteStore = useReviewQuotes(game.id);

  useEffect(() => {
    setReviewsList(game.igdbReviews ?? []);
    reviewsListRef.current = game.igdbReviews ?? [];
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reviewsListRef.current = reviewsList;
  }, [reviewsList]);

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
        setExternalReviews((prev) => ({ ...prev, [src]: reviews }));
        if (reviews.length > 0) {
          const labels: Record<string, string> = {
            metacritic: "Metacritic",
            opencritic: "OpenCritic",
          };
          showToast(
            t("review.fetchedFromSource", {
              count: reviews.length,
              source: labels[src] || src,
            }),
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
    [game.name, showToast, t],
  );

  useEffect(() => {
    setExternalReviews({});
    setExternalLoading({ metacritic: false, opencritic: false });
    externalFetchedRef.current = new Set();
    void fetchExternalReviews("metacritic");
  }, [game.id, fetchExternalReviews]);

  useEffect(() => {
    if (state.view !== "critics") return;
    if (state.source === "metacritic" || state.source === "opencritic") {
      void fetchExternalReviews(state.source);
    } else {
      void fetchExternalReviews("metacritic");
      void fetchExternalReviews("opencritic");
    }
  }, [state.view, state.source, game.id, fetchExternalReviews]);

  const fetchReviews = useCallback(
    async (force = false, cursor: string | null = null, currentLang: string = languageFilter) => {
      if (fetchInFlightRef.current) return;
      const targetGameId = game.id;
      fetchInFlightRef.current = true;
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
          reviewType: state.sentiment === "all" ? null : state.sentiment,
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
            for (const review of reviewsListRef.current) {
              const key = `${review.username || ""}_${review.timestampCreated || ""}_${(review.content || "").slice(0, 40)}`;
              if (!seen.has(key)) {
                seen.add(key);
                next.push(review);
              }
            }
          }

          for (const review of result.reviews) {
            const key = `${review.username || ""}_${review.timestampCreated || ""}_${(review.content || "").slice(0, 40)}`;
            if (!seen.has(key)) {
              seen.add(key);
              next.push(review);
            }
          }

          setReviewsList(next);
          reviewsListRef.current = next;
          updateGame(game.id, { igdbReviews: next });
          onReviewsFetched?.(next, result.source);

          if (isLoadMore) {
            showToast(
              t("review.loadedMore", { count: result.reviews.length, total: next.length }),
              "success",
            );
          } else if (force) {
            showToast(t("review.fetchedFromSource", { count: result.reviews.length, source: "Steam" }), "success");
          }
        } else if (isLoadMore) {
          setNextCursor(null);
          showToast(t("review.noMoreReviews"), "info");
        } else if (force) {
          showToast(t("review.noneAvailable"), "info");
        }
      } catch (err) {
        console.error("Fetch reviews failed:", err);
        if (force || isLoadMore) {
          showToast(t("review.fetchFailed"), "error");
        }
      } finally {
        if (targetGameId === currentFetchGameIdRef.current) {
          fetchInFlightRef.current = false;
          setIsFetchingReviews(false);
          setIsLoadingMore(false);
        }
      }
    },
    [
      game,
      showToast,
      updateGame,
      onReviewsFetched,
      languageFilter,
      display,
      purchaseType,
      playtimePreset,
      playtimeMinHours,
      playtimeMaxHours,
      state.sentiment,
      playtimeDevice,
      useHelpfulSystem,
      t,
    ],
  );

  useEffect(() => {
    if (autoFetchedForRef.current === game.id) return;
    autoFetchedForRef.current = game.id;
    currentFetchGameIdRef.current = game.id;
    fetchInFlightRef.current = false;
    setNextCursor(null);

    if (game.igdbReviews && game.igdbReviews.length > 0) {
      setReviewsList(game.igdbReviews);
      reviewsListRef.current = game.igdbReviews;
    } else {
      setReviewsList([]);
      reviewsListRef.current = [];
    }
    void fetchReviews(false, null, languageFilter);
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const queryKey = useMemo(
    () =>
      JSON.stringify({
        d: display,
        st: state.sentiment,
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
      state.sentiment,
      purchaseType,
      languageFilter,
      playtimePreset,
      playtimeMinHours,
      playtimeMaxHours,
      playtimeDevice,
      useHelpfulSystem,
    ],
  );

  const queryKeyRef = useRef(queryKey);
  useEffect(() => {
    if (queryKeyRef.current === queryKey) return;
    queryKeyRef.current = queryKey;
    setNextCursor(null);
    void fetchReviews(true, null, languageFilter);
  }, [queryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const allReviews: ReviewItem[] = useMemo(() => {
    const items: ReviewItem[] = [];

    reviewsList.forEach((review: IgdbReview, index: number) => {
      const content = review.content || "";
      items.push({
        id: `steam-${index}`,
        sourceIndex: index,
        source: "steam",
        sourceLabel: "Steam",
        username: review.username || t("review.steamPlayer"),
        rating: review.rating ?? null,
        ratingLabel: review.rating !== undefined ? `${review.rating}/100` : "—",
        title: review.title || "",
        content,
        dateAdded: review.timestampCreated ? review.timestampCreated * 1000 : undefined,
        reviewLength: content.length,
        reviewLengthBytes: content.length,
        language: review.language,
        sentiment: ratingToSentiment(review.rating ?? null),
        votesUp: review.votesUp,
        votesFunny: review.votesFunny,
        reactions: review.reactions,
        commentCount: review.commentCount,
        authorPlaytimeAtReview: review.authorPlaytimeAtReview,
        authorPlaytimeForever: review.authorPlaytimeForever,
        authorDeckPlaytimeAtReview: review.authorDeckPlaytimeAtReview,
        primarilySteamDeck: review.primarilySteamDeck,
        receivedForFree: review.receivedForFree,
        writtenDuringEarlyAccess: review.writtenDuringEarlyAccess,
        steamPurchase: review.steamPurchase,
        authorSteamId: review.authorSteamId,
        hw: review.hw,
      });
    });

    const externalLabels: Record<string, string> = {
      metacritic: "Metacritic",
      opencritic: "OpenCritic",
    };

    let externalIndex = items.length;
    for (const [source, label] of Object.entries(externalLabels)) {
      const reviews = externalReviews[source];
      if (!reviews || reviews.length === 0) continue;
      reviews.forEach((review: IgdbReview) => {
        const content = review.content || "";
        items.push({
          id: `${source}-${externalIndex++}`,
          sourceIndex: externalIndex,
          source: source as ReviewItem["source"],
          sourceLabel: label,
          username: review.username || label,
          rating: review.rating ?? null,
          ratingLabel: review.rating !== undefined ? `${Math.round(review.rating)}/100` : "—",
          title: review.title || "",
          content,
          dateAdded: review.timestampCreated ? review.timestampCreated * 1000 : undefined,
          reviewLength: content.length,
          reviewLengthBytes: content.length,
          language: review.language,
          sentiment: ratingToSentiment(review.rating ?? null),
        });
      });
    }

    return items;
  }, [reviewsList, externalReviews, t]);

  const filteredReviews = useMemo(() => {
    let list = allReviews.slice();
    if (state.view === "community") {
      list = list.filter((review) => review.source === "steam");
    } else if (state.view === "critics") {
      list = list.filter((review) => review.source !== "steam");
      if (state.source !== "all") {
        list = list.filter((review) => review.source === state.source);
      }
      if (state.sentiment !== "all") {
        list = list.filter((review) => review.sentiment === state.sentiment);
      }
    } else {
      list = [];
    }
    if (languageFilter !== "all") {
      list = list.filter((review) => review.language === languageFilter);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(
        (review) =>
          review.content.toLowerCase().includes(query) ||
          review.title.toLowerCase().includes(query) ||
          review.username.toLowerCase().includes(query),
      );
    }
    return list.sort((a, b) => a.sourceIndex - b.sourceIndex);
  }, [allReviews, state.view, state.source, state.sentiment, languageFilter, searchQuery]);

  const externalSources: ExternalSourceDescriptor[] = useMemo(() => {
    const sources: ExternalSourceDescriptor[] = [];
    if (game.metadataUrl && game.metadataSource) {
      sources.push({
        id: "metadata",
        name: game.metadataSource,
        url: game.metadataUrl,
        description: t("review.viewMetadata", { source: game.metadataSource }),
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
          description: t("review.readSteamReviews"),
          accent: "var(--review-source-steam)",
        });
      }
    }
    sources.push(
      {
        id: "metacritic",
        name: "Metacritic",
        url: buildExternalUrl(game, "metacritic"),
        description: t("review.searchOnSite", { site: "Metacritic", name: gameDisplayName(game) }),
        accent: "var(--review-source-metacritic)",
        criticKey: "metacritic",
      },
      {
        id: "opencritic",
        name: "OpenCritic",
        url: buildExternalUrl(game, "opencritic"),
        description: t("review.searchOnSite", { site: "OpenCritic", name: gameDisplayName(game) }),
        accent: "var(--review-source-opencritic)",
        criticKey: "opencritic",
      },
    );
    return sources;
  }, [game, t]);

  const steamCount =
    totalReviewCount > 0
      ? totalReviewCount
      : allReviews.filter((review) => review.source === "steam").length;
  const metacriticCount = externalReviews.metacritic?.length ?? 0;
  const opencriticCount = externalReviews.opencritic?.length ?? 0;
  const totalCritics = metacriticCount + opencriticCount;
  const totalAll = steamCount + totalCritics;
  const appId = resolveSteamAppId(game);

  const criticCounts = useMemo(
    () => ({ metacritic: metacriticCount, opencritic: opencriticCount }),
    [metacriticCount, opencriticCount],
  );

  const criticLabels: Record<string, string> = {
    metacritic: "Metacritic",
    opencritic: "OpenCritic",
  };

  const openExternal = useCallback(
    (url: string) => {
      openUrl(url).catch((err) => {
        showToast(t("review.openLinkFailed"), "error");
        console.error(err);
      });
    },
    [showToast, t],
  );

  const criticLoading =
    state.source === "all"
      ? externalLoading.metacritic || externalLoading.opencritic
      : externalLoading[state.source];

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (purchaseType !== "all") count += 1;
    if (languageFilter !== "all") count += 1;
    if (playtimePreset !== "none") count += 1;
    if (showDeckVerified && playtimeDevice !== "all") count += 1;
    if (useHelpfulSystem) count += 1;
    if (display !== "all") count += 1;
    return count;
  }, [
    display,
    purchaseType,
    languageFilter,
    playtimePreset,
    playtimeDevice,
    useHelpfulSystem,
    showDeckVerified,
  ]);

  const handleResetFilters = useCallback(() => {
    setDisplay("all");
    setPurchaseType("all");
    setLanguageFilter("all");
    setPlaytimePreset("none");
    setPlaytimeMinHours(0);
    setPlaytimeMaxHours(0);
    setPlaytimeDevice("all");
    setHelpfulnessRaw("0");
    setSearchQuery("");
    setState({ sentiment: "all" });
  }, [setDisplay, setHelpfulnessRaw, setLanguageFilter, setPlaytimeDevice, setPlaytimePreset, setState]);

  const reviewUrlFor = useCallback(
    (review: ReviewItem): string | null => {
      if (review.source !== "steam") return null;
      if (!review.authorSteamId || !appId) return null;
      return `https://steamcommunity.com/profiles/${review.authorSteamId}/recommended/${appId}/`;
    },
    [appId],
  );

  const handleBookmark = useCallback(
    async (review: ReviewItem) => {
      const key = reviewKeyOf(review);
      const existing = quoteStore.quotes.find(
        (quote) => quote.kind === "review" && quote.reviewKey === key,
      );
      if (existing) {
        const ok = await quoteStore.remove(existing.id);
        showToast(
          ok ? t("review.bookmarkRemoved") : t("review.quoteSaveFailed"),
          ok ? "info" : "error",
        );
        return;
      }
      const saved = await quoteStore.save(reviewDraft(game, review, reviewUrlFor(review)));
      showToast(
        saved ? t("review.bookmarkSaved") : t("review.quoteSaveFailed"),
        saved ? "success" : "error",
      );
    },
    [game, quoteStore, reviewUrlFor, showToast, t],
  );

  const handleSaveQuote = useCallback(
    async (review: ReviewItem, excerpt: string) => {
      const saved = await quoteStore.save(
        excerptDraft(game, review, excerpt, reviewUrlFor(review)),
      );
      showToast(
        saved ? t("review.quoteSaved") : t("review.quoteSaveFailed"),
        saved ? "success" : "error",
      );
    },
    [game, quoteStore, reviewUrlFor, showToast, t],
  );

  const handleDeleteQuote = useCallback(
    async (id: string) => {
      const ok = await quoteStore.remove(id);
      showToast(
        ok ? t("review.quoteDeleted") : t("review.quoteSaveFailed"),
        ok ? "info" : "error",
      );
    },
    [quoteStore, showToast, t],
  );

  const tabNav = [
    {
      id: "community" as const,
      label: t("review.userReviews"),
      icon: MessageSquare,
      count: steamCount,
    },
    {
      id: "critics" as const,
      label: t("reviewsTab.critics"),
      icon: Newspaper,
      count: totalCritics,
    },
    {
      id: "saved" as const,
      label: t("review.savedQuotes"),
      icon: Bookmark,
      count: quoteStore.quotes.length,
    },
  ];

  const feedTitle =
    state.view === "community"
      ? t("review.communityReviews")
      : state.view === "critics"
        ? t("reviewsTab.critics")
        : t("review.savedQuotes");

  const feedCount =
    state.view === "community"
      ? steamCount
      : state.view === "critics"
        ? totalCritics
        : quoteStore.quotes.length;

  return (
    <section className="game-tab rv-workspace-shell">
      <div className="rv-workspace" style={REVIEW_SOURCE_ACCENTS as CSSProperties}>
        <header className="rv-rail__head">
          <span className="game-tab__icon" aria-hidden="true">
            <MessageSquare size={20} />
          </span>
          <div className="game-tab__heading">
            <span className="game-tab__eyebrow">{t("game.tab.reviews")}</span>
            <h2 className="game-tab__title">{t("review.reviewsTitle")}</h2>
            <p className="game-tab__desc">
              {totalAll > 0
                ? t("review.subtitleCount", { count: totalAll.toLocaleString() })
                : t("review.subtitleNone")}
            </p>
          </div>
        </header>

        <header className="rv-feed__head">
          <span className="game-tab__eyebrow">
            {t("review.feedCount", { count: feedCount })}
          </span>
          <h2 className="game-tab__title">{feedTitle}</h2>
        </header>

        <aside className="rv-rail">
          <div className="rv-rail__summary">
            <ReviewSummaryHero
              reviews={allReviews}
              totalReviewCount={totalAll}
              steamReviewScoreDesc={steamReviewScoreDesc}
              steamReviewScore={steamReviewScore}
              steamTotalPositive={steamTotalPositive}
              steamTotalNegative={steamTotalNegative}
              onFilterSentiment={(sentiment) => setState({ sentiment })}
              activeSentimentFilter={state.sentiment}
            />
          </div>

          <nav className="rv-rail__nav" aria-label={t("review.viewsLabel")}>
            {tabNav.map((item) => {
              const Icon = item.icon;
              const active = state.view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`rv-rail__nav-btn${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setState({ view: item.id })}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                  {item.count > 0 && <span className="rv-rail__nav-count">{item.count}</span>}
                </button>
              );
            })}
          </nav>

          <div className="rv-rail__meta">
            <span>{t("review.railHint")}</span>
          </div>
        </aside>

        <div className="rv-feed">
          {state.view !== "saved" && (
            <GameTabToolbar
              search={
                <GameTabSearch
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={t("review.searchPlaceholder")}
                  label={t("review.searchPlaceholder")}
                  clearLabel={t("review.clearSearch")}
                />
              }
              filters={
                state.view === "community" ? (
                  <GameTabChips
                    items={[
                      { id: "all" as const, label: t("review.allReviews") },
                      { id: "positive" as const, label: t("review.recommended") },
                      { id: "negative" as const, label: t("review.notRecommended") },
                    ]}
                    value={state.sentiment}
                    onChange={(sentiment) => setState({ sentiment })}
                    ariaLabel={t("review.reviewType")}
                  />
                ) : (
                  <GameTabChips
                    items={[
                      { id: "all" as const, label: t("review.allCritics"), count: totalCritics },
                      {
                        id: "metacritic" as const,
                        label: "Metacritic",
                        count: criticCounts.metacritic,
                      },
                      {
                        id: "opencritic" as const,
                        label: "OpenCritic",
                        count: criticCounts.opencritic,
                      },
                    ]}
                    value={state.source}
                    onChange={(source) => setState({ source })}
                    ariaLabel={t("review.sourceLabel")}
                  />
                )
              }
              actions={
                <>
                  <div className="rv-filter-anchor">
                    <Button
                      variant={activeFilterCount > 0 ? "secondary" : "ghost"}
                      size="sm"
                      leftIcon={<SlidersHorizontal size={14} />}
                      onClick={() => setFilterOpen((open) => !open)}
                      aria-expanded={filterOpen}
                    >
                      {t("review.filters")}
                      {activeFilterCount > 0 && (
                        <span className="rv-filter-count">{activeFilterCount}</span>
                      )}
                    </Button>
                    <ReviewsFilterPopover
                      open={filterOpen}
                      onClose={() => setFilterOpen(false)}
                      display={display}
                      onDisplayChange={setDisplay}
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
                      onUseHelpfulSystemChange={(value) => setHelpfulnessRaw(value ? "1" : "0")}
                      showDeckVerified={showDeckVerified}
                      onReset={handleResetFilters}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={
                      <RefreshCw
                        size={14}
                        className={isFetchingReviews ? "spin-animation" : undefined}
                      />
                    }
                    onClick={() => void fetchReviews(true, null)}
                    disabled={isFetchingReviews}
                  >
                    {t("review.refreshReviews")}
                  </Button>
                </>
              }
              below={
                activeFilterCount > 0 || searchQuery ? (
                  <div className="rv-active-filters">
                    {activeFilterCount > 0 && (
                      <span className="rv-active-filters__label">
                        {t("review.filterCount", { count: activeFilterCount })}
                      </span>
                    )}
                    <button type="button" onClick={handleResetFilters}>
                      {t("review.resetFilters")}
                    </button>
                  </div>
                ) : null
              }
            />
          )}

          {state.view === "saved" ? (
            <ReviewsSavedQuotes
              quotes={quoteStore.quotes}
              loading={quoteStore.loading}
              onDelete={(id) => void handleDeleteQuote(id)}
            />
          ) : state.view === "critics" && criticLoading ? (
            <ReviewsEmptyState
              type="critic-loading"
              criticSource={state.source === "all" ? "metacritic" : state.source}
              criticLabel={criticLabels[state.source === "all" ? "metacritic" : state.source]}
            />
          ) : state.view === "critics" && totalCritics === 0 ? (
            <ReviewsEmptyState
              type="critic-empty"
              criticSource={state.source}
              criticLabel={criticLabels[state.source === "all" ? "metacritic" : state.source]}
              onOpenExternalCritic={() =>
                openExternal(
                  buildExternalUrl(
                    game,
                    state.source === "opencritic" ? "opencritic" : "metacritic",
                  ),
                )
              }
            />
          ) : isFetchingReviews && filteredReviews.length === 0 ? (
            <GameTabSkeleton count={3} height={180} />
          ) : totalAll === 0 ? (
            <GameTabEmpty
              icon={<MessageSquare size={26} />}
              title={t("review.emptyTitle")}
              description={t("review.emptyDesc")}
              actions={
                <Button variant="primary" size="sm" onClick={() => void fetchReviews(true, null)}>
                  {t("review.refreshReviews")}
                </Button>
              }
            />
          ) : filteredReviews.length === 0 ? (
            <ReviewsEmptyState type="no-matches" onResetFilters={handleResetFilters} />
          ) : (
            <div className="rv-list">
              <div className="rv-list-rows">
                {filteredReviews.map((review) =>
                  review.source === "metacritic" || review.source === "opencritic" ? (
                    <CriticReviewRow
                      key={review.id}
                      review={review}
                      searchQuery={searchQuery}
                      bookmarked={quoteStore.isBookmarked(reviewKeyOf(review))}
                      onBookmark={(next) => void handleBookmark(next)}
                      onSaveQuote={(next, excerpt) => void handleSaveQuote(next, excerpt)}
                    />
                  ) : (
                    <ReviewRow
                      key={review.id}
                      review={review}
                      appId={appId}
                      searchQuery={searchQuery}
                      bookmarked={quoteStore.isBookmarked(reviewKeyOf(review))}
                      onBookmark={(next) => void handleBookmark(next)}
                      onSaveQuote={(next, excerpt) => void handleSaveQuote(next, excerpt)}
                    />
                  ),
                )}
              </div>

              {nextCursor && state.view === "community" && (
                <div className="rv-load-more-row">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void fetchReviews(false, nextCursor, languageFilter)}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore
                      ? t("review.loadingMore")
                      : t("review.loadMoreReviews")}
                  </Button>
                </div>
              )}
            </div>
          )}

          {state.view !== "saved" && (
            <ReviewsExternalShowcase
              sources={externalSources}
              openExternal={openExternal}
              isBigScreen={isBigScreen}
              criticCounts={criticCounts}
              onShowInApp={(source) =>
                setState({ view: "critics", source: source as CriticSource })
              }
            />
          )}
        </div>
      </div>
    </section>
  );
}
