import { useEffect, useRef, useState, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../../types/game";
import StoreGameCard from "./StoreGameCard";
import { useLanguage } from "../../context/LanguageContext";

type HeroCategory = "hot" | "weekly" | "trending";

interface StoreFeaturedHeroProps {
  /** Navigate to a game's detail page. */
  onPickGame: (game: StoreGameSummary) => void;
}

/**
 * Featured rail tabs map to GameLib's IGDB store feed (`fetch_store_games`):
 * Hot Now = hypes-ranked, Game of the Week = top-rated rotated by ISO week,
 * Trending = most-followed. "Surprise me" jumps to a random game.
 */
const TABS: {
  id: HeroCategory;
  label: string;
  icon: ReactElement;
}[] = [
  {
    id: "hot",
    label: "Hot Now",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2c1 3-1 4-1 6 0 1.5 1 2 2 2 2 0 2-2 2-4 3 2 5 5 5 9 0 4-3 7-7 8-3 .7-5-1-6-3-2-3-1-7 1-9 1-2 4-4 5-7z" />
      </svg>
    ),
  },
  {
    id: "weekly",
    label: "Game of the Week",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M9 16l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: "trending",
    label: "Trending",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
];

const HERO_LIMIT = 12;

/** ISO-8601 week number of a date (UTC Thursday trick). */
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Featured rail: a wide banner of up to 12 game cards with pill subtabs
 * (Hot Now / Game of the Week / Trending) backed by GameLib's IGDB store
 * feed — the grid below keeps its own sort. "Surprise me" jumps to a
 * random card from the visible rail.
 */
export default function StoreFeaturedHero({ onPickGame }: StoreFeaturedHeroProps) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<HeroCategory>("hot");
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [surprising, setSurprising] = useState(false);
  const cacheRef = useRef<Partial<Record<HeroCategory, StoreGameSummary[]>>>({});
  const reqRef = useRef(0);

  useEffect(() => {
    const cached = cacheRef.current[tab];
    if (cached) {
      setGames(cached);
      setLoading(false);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    // Same IGDB-backed feed the main game grid uses (`fetch_store_games`).
    const args: { category: string; offset: number; limit: number; sort?: string } =
      tab === "hot"
        ? { category: "trending", offset: 0, limit: HERO_LIMIT }
        : tab === "weekly"
          ? { category: "top", offset: 0, limit: HERO_LIMIT }
          : { category: "all", offset: 0, limit: HERO_LIMIT, sort: "follows" };
    invoke<StoreGameSummary[]>("fetch_store_games", args)
      .then((res) => {
        if (id !== reqRef.current) return;
        const games =
          tab === "weekly" && res.length > 0
            ? (() => {
                const offset = isoWeekNumber(new Date()) % res.length;
                return [...res.slice(offset), ...res.slice(0, offset)];
              })()
            : res;
        cacheRef.current[tab] = games;
        setGames(games);
        setLoading(false);
      })
      .catch(() => {
        if (id === reqRef.current) setLoading(false);
      });
  }, [tab]);

  const handleSurprise = async () => {
    if (surprising) return;
    // Fetch a genuinely random game from the whole catalogue (the same
    // "surprise me" behaviour as Hydra Launcher) rather than just
    // picking from the cards currently on screen.
    setSurprising(true);
    try {
      const game = await invoke<StoreGameSummary>("get_random_store_game");
      onPickGame(game);
    } catch {
      // Fallback: pick a random card from the visible rail.
      if (games.length > 0) {
        onPickGame(games[Math.floor(Math.random() * games.length)]);
      }
    } finally {
      setSurprising(false);
    }
  };

  return (
    <section className="store-featured-section" aria-label={t("store.highlightsAria")}>
      <div className="store-featured-head">
        <div className="store-featured-tablist" role="tablist" aria-label={t("store.featuredCategoriesAria")}>
          {TABS.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              aria-selected={tab === tabItem.id}
              className={`store-featured-tab${tab === tabItem.id ? " active" : ""}`}
              onClick={() => setTab(tabItem.id)}
            >
              <span className="store-featured-tab-icon" aria-hidden="true">
                {tabItem.icon}
              </span>
              {t(`store.featured.${tabItem.id}`)}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`store-featured-surprise${surprising ? " is-spinning" : ""}`}
          onClick={handleSurprise}
          title={t("store.surpriseTitle")}
          disabled={surprising}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
          </svg>
          {t("store.surpriseMe")}
        </button>
      </div>

      <div className="store-featured-rail">
        {loading && games.length === 0
          ? Array.from({ length: HERO_LIMIT }).map((_, i) => (
              <div
                key={i}
                className="store-game-card store-game-card-skeleton density-cinematic"
              >
                <div className="store-card-cover">
                  <div className="store-card-cover-skeleton" />
                </div>
              </div>
            ))
          : games.map((g) => (
              <StoreGameCard
                key={`${tab}-${g.id}-${g.slug}`}
                game={g}
                onClick={onPickGame}
                density="cinematic"
              />
            ))}
      </div>
    </section>
  );
}
