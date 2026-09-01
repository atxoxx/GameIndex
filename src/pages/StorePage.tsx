import { useEffect, useRef, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { usePresence } from "../context/PresenceContext";
import { useStoreCatalogue } from "../hooks/useStoreCatalogue";
import {
  getStoreSearchQueryFromSearchParams,
  setStoreSearchQueryInSearchParams,
} from "../components/store/storeSearchQuery";
import StoreHeader from "../components/store/StoreHeader";
import StoreToolbar from "../components/store/StoreToolbar";
import StoreFilterPanel from "../components/store/StoreFilterPanel";
import StoreFeaturedHero from "../components/store/StoreFeaturedHero";
import StoreGameGrid from "../components/store/StoreGameGrid";
import StoreBulkBar from "../components/store/StoreBulkBar";
import StoreCompareTray from "../components/store/StoreCompareTray";
import StoreCompareModal from "../components/store/StoreCompareModal";
import "../styles/page-store.css";

export default function StorePage() {
  const c = useStoreCatalogue();
  const { setStorePlatforms } = usePresence();
  const [searchParams, setSearchParams] = useSearchParams();

  // Keep Presence in sync with the selected platform filter (for Discord etc.)
  useEffect(() => {
    setStorePlatforms(c.selectedPlatforms);
  }, [c.selectedPlatforms, setStorePlatforms]);

  // ── URL ↔ catalogue sync ──────────────────────────────────────────────
  // Lane A provides: unified 280ms debounce, deduped IGDB via searchMemoryCache/
  // dedupedSearchFetch, instant Enter via flushSearch/setSearchQueryImmediate/
  // applyExternalQuery. Lane B (this file) owns URL shareability.
  //
  //  - On mount and on searchParams change, consume ?q= and call
  //    catalogue.applyExternalQuery(q) (immediate, no debounce).
  //  - On catalogue.searchQuery change, debounce 300ms and write ?q=
  //    via setSearchParams({ replace: true }) so typing doesn't spam history
  //    but distinct queries are still deep-linkable and back/forward works.
  //  - Empty query removes the param (delete).
  //  - BigScreen overlay navigates via buildStoreSearchUrl("/store", q) which
  //    lands here as ?q=; Lane A's cache ensures no duplicate IGDB fetch
  //    if the same query was fetched recently (10-min TTL).

  const lastAppliedUrlRef = useRef<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL → catalogue (mount + back/forward). Apply externally so highlights
  // and grid show the shared query immediately without a second debounce.
  useEffect(() => {
    const urlQ = getStoreSearchQueryFromSearchParams(searchParams).trim();
    const currentQ = c.searchQuery.trim();
    if (urlQ === currentQ) {
      lastAppliedUrlRef.current = urlQ;
      return;
    }
    // Avoid echo after our own catalogue→URL sync (lastAppliedUrlRef guards)
    if (lastAppliedUrlRef.current === urlQ) return;
    lastAppliedUrlRef.current = urlQ;
    c.applyExternalQuery(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, c.applyExternalQuery]);

  // catalogue → URL (debounced 300ms, replaceState-style, shareable)
  useEffect(() => {
    const q = c.searchQuery.trim();
    const currentUrlQ = getStoreSearchQueryFromSearchParams(searchParams).trim();
    if (q === currentUrlQ) {
      lastAppliedUrlRef.current = q;
      return;
    }
    // Cancel any pending URL write
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    // Empty query → remove param immediately (no debounce) so the address bar
    // reflects the cleared state promptly while still using replace.
    if (q === "") {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setStoreSearchQueryInSearchParams(next, "");
          return next;
        },
        { replace: true }
      );
      lastAppliedUrlRef.current = "";
      return;
    }
    // Debounce non-empty writes to coalesce rapid typing and avoid history spam
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setStoreSearchQueryInSearchParams(next, q);
          return next;
        },
        { replace: true }
      );
      lastAppliedUrlRef.current = q;
    }, 300);
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [c.searchQuery, searchParams, setSearchParams]);

  return (
    <div className="store-page page">
      <StoreHeader catalogue={c} />

      {/* Featured Spotlight Showcase */}
      <div className="fade-up ui-complete-only" style={{ "--d": "120ms" } as CSSProperties}>
        <StoreFeaturedHero onPickGame={c.onCardClick} />
      </div>

      <div className="store-layout store-layout-in" style={{ "--d": "200ms" } as CSSProperties}>
        <StoreFilterPanel catalogue={c} />

        <div className="store-main">
          <StoreToolbar catalogue={c} />

          <StoreGameGrid
            games={c.displayedGames}
            loading={c.loading}
            error={c.error}
            hasMore={c.hasMore}
            onLoadMore={c.loadMore}
            onCardClick={c.onCardClick}
            isSourceFilterActive={c.isSourceFilterActive}
            isSourceCheckPending={c.sourceChecksPending > 0}
            isInLibrary={c.isInLibrary}
            onHide={c.onHide}
            onCompare={c.addCompare}
            bulkMode={c.bulkMode}
            selectedSlugs={c.selectedSlugs}
            onToggleSelect={c.toggleSelect}
            onClearFilters={c.resetFilters}
            onClearSearch={() => c.applyExternalQuery("")}
          />
        </div>

        {c.bulkMode && (
          <StoreBulkBar
            selectedCount={c.selectedSlugs.size}
            totalCount={c.displayedGames.length}
            onSelectAll={c.selectAllVisible}
            onClear={c.clearSelection}
            onWishlistAll={c.wishlistAll}
            onHideAll={c.hideAll}
            onAddAll={c.addAll}
            onExit={() => {
              c.setBulkMode(false);
              c.clearSelection();
            }}
            addingAll={c.addingAll}
          />
        )}

        <div className="ui-complete-only">
          {!c.bulkMode && c.compareGames.length > 0 && (
            <StoreCompareTray
              games={c.compareGames}
              onRemove={c.removeCompare}
              onClear={c.clearCompare}
              onOpen={() => c.setCompareOpen(true)}
            />
          )}

          {c.compareOpen && c.compareGames.length >= 2 && (
            <StoreCompareModal
              games={c.compareGames}
              onClose={() => c.setCompareOpen(false)}
              onOpenGame={(g) => {
                c.setCompareOpen(false);
                c.onCardClick(g);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
