// BigScreenStore — Store and Wishlist inside Big Screen Mode.
//
// Both views share one fetch and one selection model: `useFocusedGame`
// re-resolves the remembered card id against the current list on every
// render, so the featured panel follows the controller without ever
// holding a `StoreGameSummary` that the data may have replaced.
//
// Composition is per preset, data is not:
//   • PlayStation — art band with the store's primary action, then
//     landscape rails.
//   • Xbox — hero band with the fact card on the right, then rails.
//   • Steam — compact spotlight (poster thumb, fact chips) over poster
//     rails.
//   • Switch — a brand-coloured store strip, the featured square row,
//     then square rails; no featured panel at all (the tiles are the
//     page).
//   • Classic — the shipped spotlight over the shipped rails.
//
// The wishlist keeps its grid and its own preview line: activating a
// card opens that card's store page, never the previously featured one.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useWishlistContext } from "../../context/WishlistContext";
import { useLanguage } from "../../context/LanguageContext";
import { useActivePreset } from "../../context/BigScreenPrefsContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGameBackdropArt } from "../../hooks/useGameBackdropArt";
import BigScreenStoreRail from "./BigScreenStoreRail";
import BigScreenDashboardBackdrop from "../bigscreen/BigScreenDashboardBackdrop";
import BigScreenPill from "../bigscreen/BigScreenPill";
import BigScreenSelectionPreview from "../bigscreen/selection/BigScreenSelectionPreview";
import { useFocusedGame } from "../bigscreen/selection/useFocusedGame";
import { extractYear } from "../bigscreen/bigscreenFormat";
import type { StoreGameSummary } from "../../types/game";
import "../../styles/wishlist.css";

/** Keep the first occurrence of each game id across the four shelves. */
function dedupeById(lists: StoreGameSummary[][]): StoreGameSummary[] {
  const seen = new Set<number>();
  const out: StoreGameSummary[] = [];
  for (const game of lists.flat()) {
    if (seen.has(game.id)) continue;
    seen.add(game.id);
    out.push(game);
  }
  return out;
}

export default function BigScreenStore() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const preset = useActivePreset();
  const presetId = preset.id;
  const { wishlist } = useWishlistContext();

  // BigScreenStore mounts at /store and /wishlist only (the /deals route
  // renders BigScreenDeals). There are no in-page subtabs — the top-level
  // header strip owns Store / Wishlist / Deals — so the view is derived
  // straight from the route instead of tab state.
  const view = location.pathname.startsWith("/wishlist") ? "wishlist" : "trending";

  // Trending state
  const [trending, setTrending] = useState<StoreGameSummary[]>([]);
  const [popular, setPopular] = useState<StoreGameSummary[]>([]);
  const [top, setTop] = useState<StoreGameSummary[]>([]);
  const [comingSoon, setComingSoon] = useState<StoreGameSummary[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(true);

  // Fetch Trending categories
  useEffect(() => {
    let active = true;
    const fetchTrending = async () => {
      setLoadingTrending(true);
      try {
        const fetchCat = (cat: string) =>
          invoke<StoreGameSummary[]>("fetch_store_games", {
            category: cat,
            offset: 0,
            limit: 12,
          });

        const [tr, pop, tp, cs] = await Promise.all([
          fetchCat("trending"),
          fetchCat("popular"),
          fetchCat("top"),
          fetchCat("coming_soon"),
        ]);

        if (active) {
          setTrending(tr);
          setPopular(pop);
          setTop(tp);
          setComingSoon(cs);
        }
      } catch (err) {
        console.error("Failed to load trending storefront:", err);
      } finally {
        if (active) setLoadingTrending(false);
      }
    };
    fetchTrending();
    return () => {
      active = false;
    };
  }, []);

  const storePool = useMemo(
    () => dedupeById([trending, popular, top, comingSoon]),
    [trending, popular, top, comingSoon],
  );

  // Two lists, two resolvers: the controller is either browsing the
  // storefront shelves or the wishlist grid, and each page renders only
  // the selection that belongs to the list it is showing.
  const { item: storeGame, railId: storeRailId } = useFocusedGame({
    items: storePool,
    getId: (game) => String(game.id),
  });

  const { item: wishlistGame } = useFocusedGame({
    items: wishlist,
    getId: (entry) => String(entry.id),
  });

  const storeBackdrop = useGameBackdropArt(storeGame);
  const wishlistBackdrop = useGameBackdropArt(wishlistGame);

  const handleCardClick = useCallback(
    (game: StoreGameSummary) => {
      navigate(`/store/${game.slug}`);
    },
    [navigate],
  );

  const handleDetails = useCallback(() => {
    if (storeGame) navigate(`/store/${storeGame.slug}`);
  }, [storeGame, navigate]);

  const handleWishlistDetails = useCallback(() => {
    if (wishlistGame) navigate(`/store/${wishlistGame.slug}`);
  }, [wishlistGame, navigate]);

  const detailsFocusable = useFocusable(handleDetails);
  const wishlistDetailsFocusable = useFocusable(handleWishlistDetails);

  const featuredLogo = useMemo(() => {
    if (storeGame?.logoUrl) return storeGame.logoUrl;
    if (storeGame?.websites) {
      for (const url of storeGame.websites) {
        const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
        if (match) {
          return `https://cdn.cloudflare.steamstatic.com/steam/apps/${match[1]}/logo.png`;
        }
      }
    }
    return null;
  }, [storeGame?.logoUrl, storeGame?.websites]);

  const storeFacts = useMemo<Array<{ label: string; value: string }>>(() => {
    if (!storeGame) return [];
    const facts: Array<{ label: string; value: string }> = [];
    if (storeGame.rating) {
      facts.push({ label: "IGDB", value: String(Math.round(storeGame.rating)) });
    }
    const year = extractYear(storeGame.firstReleaseDate ?? undefined);
    if (year) facts.push({ label: t("gameInfo.releaseDate"), value: String(year) });
    if (storeGame.genres?.[0]) {
      facts.push({
        label: t("bigscreen.overview.genres"),
        value: storeGame.genres.slice(0, 2).join(" · "),
      });
    }
    return facts;
  }, [storeGame, t]);

  const storeMeta = storeGame ? (
    <>
      {storeGame.rating ? (
        <BigScreenPill tone="accent" size="sm">
          {t("bigscreen.store.score", { score: Math.round(storeGame.rating) })}
        </BigScreenPill>
      ) : null}
      {storeGame.genres?.slice(0, 2).map((genre) => (
        <BigScreenPill key={genre} tone="muted" size="sm">
          {genre}
        </BigScreenPill>
      ))}
    </>
  ) : undefined;

  const wishlistMeta = wishlistGame ? (
    <>
      {wishlistGame.rating ? (
        <BigScreenPill tone="accent" size="sm">
          {t("bigscreen.store.score", { score: Math.round(wishlistGame.rating) })}
        </BigScreenPill>
      ) : null}
      {wishlistGame.genres?.slice(0, 2).map((genre) => (
        <BigScreenPill key={genre} tone="muted" size="sm">
          {genre}
        </BigScreenPill>
      ))}
    </>
  ) : undefined;

  const detailsIcon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );

  const isPlaystation = presetId === "playstation";
  const isXbox = presetId === "xbox";
  const isSwitch = presetId === "switch";

  // PlayStation's band is the store's landing action, so it carries the
  // controller's entry focus; every other preset enters on the shelves.
  const storeActions = (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--primary"
      {...detailsFocusable}
      data-bs-autofocus={isPlaystation ? "true" : undefined}
    >
      {detailsIcon}
      <span>
        {t(
          isPlaystation
            ? "bigscreen.store.viewStorePage"
            : "bigscreen.store.storeDetails",
        )}
      </span>
    </button>
  );

  const wishlistActions = (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--primary"
      {...wishlistDetailsFocusable}
    >
      {detailsIcon}
      <span>{t("bigscreen.store.viewStorePage")}</span>
    </button>
  );

  const storeInfo = storeGame
    ? {
        id: String(storeGame.id),
        title: storeGame.name,
        logoUrl: featuredLogo,
        description: storeGame.summary,
        coverUrl: storeGame.coverUrl,
      }
    : null;

  const wishlistInfo = wishlistGame
    ? {
        id: String(wishlistGame.id),
        title: wishlistGame.name,
        logoUrl: wishlistGame.logoUrl,
        description: wishlistGame.summary,
        coverUrl: wishlistGame.coverUrl,
      }
    : null;

  const storeRails = [
    { railId: "trending", titleKey: "store.tab.trending", games: trending },
    { railId: "popular", titleKey: "bigscreen.store.popularNow", games: popular },
    { railId: "top", titleKey: "bigscreen.store.topCritic", games: top },
    { railId: "coming-soon", titleKey: "store.tab.comingSoon", games: comingSoon },
  ];

  // Switch's featured row already shows trending, so only the shelves
  // below it keep their headings.
  const shelfRails = isSwitch ? storeRails.slice(1) : storeRails;

  return (
    <div className="bigscreen-store-dashboard" data-preset={presetId}>
      {/* Dynamic full-bleed backdrop (trending view only; Switch is flat
          by design and its featured row is the artwork). */}
      {view === "trending" && !isSwitch ? (
        <BigScreenDashboardBackdrop
          staticUrl={storeBackdrop.staticUrl}
          animatedUrl={storeBackdrop.animatedUrl}
          artKey={storeGame?.id ?? null}
        />
      ) : null}

      {/* Main scrolling wrapper */}
      <div className="bigscreen-dashboard-scrollable-content">
        {/* Content */}
        <div className="bigscreen-store-panel-content">
          {view === "wishlist" ? (
            <div className="store-wishlist-panel">
              <header className="store-wishlist-head">
                <h2 className="store-wishlist-title">{t("nav.wishlist")}</h2>
                <span className="store-wishlist-count">
                  {wishlist.length} {t("bigscreen.discover.wishlistCount")}
                </span>
              </header>

              {wishlist.length === 0 ? (
                <div className="wishlist-empty-state">
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" width="64" height="64" opacity="0.3">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  <h3>{t("bigscreen.store.wishlistEmpty")}</h3>
                  <p>{t("bigscreen.store.wishlistHint")}</p>
                </div>
              ) : (
                <>
                  <BigScreenSelectionPreview
                    preset={presetId}
                    variant={isPlaystation || isXbox ? "band" : "inline"}
                    info={wishlistInfo}
                    eyebrow={t("nav.wishlist")}
                    meta={wishlistMeta}
                    actions={wishlistActions}
                    backdrop={{
                      staticUrl: wishlistBackdrop.staticUrl,
                      animatedUrl: wishlistBackdrop.animatedUrl,
                      artKey: wishlistGame?.id ?? null,
                    }}
                  />
                  {/* No `data-rail-id` here: the engine treats a rail as a
                      single horizontal track and would stop row-wrapping in
                      this grid. Focus memory is already per card through
                      `data-focus-key`, so the grid needs no scope. */}
                  <div className="store-wishlist-grid">
                    {wishlist.map((item) => (
                      <BigScreenWishlistCard key={item.slug} item={item} />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="store-trending-panel">
              {loadingTrending ? (
                <div className="store-tab-loading">
                  <div className="store-spinner" />
                  <span>{t("bigscreen.store.loading")}</span>
                </div>
              ) : (
                <div className="store-rails-group">
                  {isSwitch ? (
                    <header className="store-switch-head">
                      <h2 className="store-switch-title">{t("nav.store")}</h2>
                      <span className="store-switch-count">{storePool.length}</span>
                    </header>
                  ) : (
                    <BigScreenSelectionPreview
                      preset={presetId}
                      variant={isPlaystation ? "band" : "hero"}
                      info={storeInfo}
                      eyebrow={t("store.spotlight.featuredTag")}
                      meta={storeMeta}
                      facts={storeFacts}
                      actions={storeActions}
                      backdrop={{
                        staticUrl: storeBackdrop.staticUrl,
                        animatedUrl: storeBackdrop.animatedUrl,
                        artKey: storeGame?.id ?? null,
                      }}
                      empty={{
                        title: t("bigscreen.store.welcomeTitle"),
                        description: t("bigscreen.store.welcomeDesc"),
                      }}
                    />
                  )}

                  {isSwitch && trending.length > 0 ? (
                    <BigScreenStoreRail
                      railId="trending"
                      title={t("bigscreen.store.featured")}
                      games={trending}
                      onCardClick={handleCardClick}
                      isActive={storeRailId === "trending"}
                      hideHeader
                    />
                  ) : null}

                  {/* Switch has no hero panel, so the focused tile still
                      needs a details line under the featured row — that is
                      the console's own pattern (title under the icon). */}
                  {isSwitch ? (
                    <BigScreenSelectionPreview
                      preset={presetId}
                      variant="inline"
                      info={storeInfo}
                      eyebrow={t("bigscreen.store.featured")}
                      meta={storeMeta}
                      actions={storeActions}
                    />
                  ) : null}

                  {shelfRails.map((rail) => (
                    <BigScreenStoreRail
                      key={rail.railId}
                      railId={rail.railId}
                      title={t(rail.titleKey)}
                      games={rail.games}
                      onCardClick={handleCardClick}
                      isActive={storeRailId === rail.railId}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BigScreenWishlistCard({ item }: { item: StoreGameSummary }) {
  const navigate = useNavigate();
  const focusProps = useFocusable(() => navigate(`/store/${item.slug}`));

  return (
    <div
      className="bigscreen-game-card store-wishlist-card"
      {...focusProps}
      role="link"
      aria-label={item.name}
      data-game-id={String(item.id)}
      data-focus-key={`store:wishlist:${item.slug}`}
    >
      <div className="bigscreen-game-card-cover">
        {item.coverUrl ? (
          <img
            className="bigscreen-game-card-cover-static"
            src={item.coverUrl}
            alt={item.name}
            loading="lazy"
          />
        ) : (
          <div className="bigscreen-game-card-cover-placeholder">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="40"
              height="40"
              aria-hidden="true"
            >
              <path d="M20.8 8.8c0 5.4-8.8 10.2-8.8 10.2S3.2 14.2 3.2 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z" />
            </svg>
          </div>
        )}
      </div>
      <div className="bigscreen-game-card-body">
        <h3 className="bigscreen-game-card-name">{item.name}</h3>
      </div>
    </div>
  );
}
