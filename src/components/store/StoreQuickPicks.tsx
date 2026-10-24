import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import type { StoreGameSummary } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import StoreQuickPickCard from "./StoreQuickPickCard";

interface StoreQuickPicksProps {
  onPickGame: (game: StoreGameSummary) => void;
  onDismiss: () => void;
}

const QUICK_PICK_LIMIT = 10;

// The storefront's front page data is fetched once per session; re-entering
// the catalogue reuses the same slice instead of re-hitting IGDB.
let quickPickCache: StoreGameSummary[] | null = null;

/**
 * One curated shelf between the spotlight and the catalogue. It is only
 * mounted while the user is browsing an unfiltered, unsearched catalogue,
 * so it reads as discovery rather than a second set of results.
 */
export default function StoreQuickPicks({
  onPickGame,
  onDismiss,
}: StoreQuickPicksProps) {
  const { t } = useLanguage();
  const [games, setGames] = useState<StoreGameSummary[]>(quickPickCache ?? []);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (quickPickCache && quickPickCache.length > 0) return;
    let cancelled = false;

    const load = async () => {
      try {
        const results = await invoke<StoreGameSummary[]>("fetch_spotlight_games", {
          category: "hot",
          limit: QUICK_PICK_LIMIT,
        });
        if (cancelled) return;
        const list = (results ?? []).slice(0, QUICK_PICK_LIMIT);
        if (list.length > 0) quickPickCache = list;
        setGames(list);
      } catch {
        // Discovery is additive: a failed fetch simply removes the shelf.
        if (!cancelled) setGames([]);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const scrollBy = useCallback((direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.8, 240), behavior: "smooth" });
  }, []);

  if (games.length === 0) return null;

  return (
    <section className="store-quick-picks" aria-labelledby="store-quick-picks-title">
      <div className="store-quick-picks-head">
        <div className="store-quick-picks-title-row">
          <span className="store-quick-picks-icon" aria-hidden="true">
            <Sparkles size={15} />
          </span>
          <div>
            <h2 id="store-quick-picks-title" className="store-quick-picks-title">
              {t("store.quickPicks.title")}
            </h2>
            <p className="store-quick-picks-sub">{t("store.quickPicks.subtitle")}</p>
          </div>
        </div>

        <div className="store-quick-picks-actions">
          <button
            type="button"
            className="store-quick-picks-nav"
            onClick={() => scrollBy(-1)}
            aria-label={t("store.quickPicks.prev")}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="store-quick-picks-nav"
            onClick={() => scrollBy(1)}
            aria-label={t("store.quickPicks.next")}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="store-quick-picks-nav store-quick-picks-dismiss"
            onClick={onDismiss}
            aria-label={t("store.quickPicks.dismiss")}
            title={t("store.quickPicks.dismiss")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="store-quick-picks-track" ref={trackRef}>
        {games.map((game) => (
          <div className="store-quick-picks-item" key={game.id}>
            <StoreQuickPickCard game={game} onClick={onPickGame} />
          </div>
        ))}
      </div>
    </section>
  );
}
