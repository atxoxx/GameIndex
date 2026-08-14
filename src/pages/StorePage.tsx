import { useEffect, type CSSProperties } from "react";
import { useSources } from "../context/SourceContext";
import { usePresence } from "../context/PresenceContext";
import { CrackWatchProvider } from "../context/CrackWatchContext";
import { PriceProvider } from "../context/PriceContext";
import { useStoreCatalogue } from "../hooks/useStoreCatalogue";
import StoreHeader from "../components/store/StoreHeader";
import StoreToolbar from "../components/store/StoreToolbar";
import StoreFilterPanel from "../components/store/StoreFilterPanel";
import StoreFeaturedHero from "../components/store/StoreFeaturedHero";
import StoreFilterChips from "../components/store/StoreFilterChips";
import StoreGameGrid from "../components/store/StoreGameGrid";
import StorePresetBar from "../components/store/StorePresetBar";
import StoreBulkBar from "../components/store/StoreBulkBar";
import StoreCompareTray from "../components/store/StoreCompareTray";
import StoreCompareModal from "../components/store/StoreCompareModal";
import "../styles/page-store.css";

export default function StorePage() {
  const c = useStoreCatalogue();
  const { sources } = useSources();
  const { setStorePlatforms } = usePresence();

  useEffect(() => {
    setStorePlatforms(c.selectedPlatforms);
  }, [c.selectedPlatforms, setStorePlatforms]);

  const onRemoveGenre = (g: string) =>
    c.setSelectedGenres(c.selectedGenres.filter((x) => x !== g));
  const onRemovePlatform = (p: string) =>
    c.setSelectedPlatforms(c.selectedPlatforms.filter((x) => x !== p));
  const onRemoveSource = (s: string) =>
    c.setSelectedSourceIds(c.selectedSourceIds.filter((x) => x !== s));

  const canSavePreset = c.activeFilterCount > 0 || c.sort !== "default";

  return (
    <CrackWatchProvider>
      <PriceProvider>
        <div className="store-page">
          <StoreHeader catalogue={c} />

          {c.activeFilterCount > 0 && (
            <div className="fade-up" style={{ "--d": "20ms" } as CSSProperties}>
              <StoreFilterChips
                selectedGenres={c.selectedGenres}
                selectedPlatforms={c.selectedPlatforms}
                yearMin={c.yearMin}
                yearMax={c.yearMax}
                ratingMin={c.ratingMin}
                selectedSourceIds={c.selectedSourceIds}
                sources={sources}
                sourceChecksPending={c.sourceChecksPending}
                onRemoveGenre={onRemoveGenre}
                onRemovePlatform={onRemovePlatform}
                onRemoveYear={() => c.setYearRange(null, null)}
                onRemoveRating={() => c.setRatingMin(null)}
                onRemoveSource={onRemoveSource}
                sourceMatchMode={c.sourceMatchMode}
                onToggleSourceMatchMode={() =>
                  c.setSourceMatchMode(c.sourceMatchMode === "any" ? "all" : "any")
                }
                resultCount={c.sourceFilterChipCount ?? c.displayedGames.length}
              />
            </div>
          )}

          {(c.presets.length > 0 || canSavePreset) && (
            <div className="fade-up" style={{ "--d": "70ms" } as CSSProperties}>
              <StorePresetBar
                presets={c.presets}
                canSave={canSavePreset}
                onApply={c.applyPreset}
                onRemove={c.removePreset}
                onSave={c.savePreset}
              />
            </div>
          )}

          {/* Featured Spotlight Showcase */}
          <div className="fade-up" style={{ "--d": "120ms" } as CSSProperties}>
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
              />
            </div>
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

          {!c.bulkMode && (
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
      </PriceProvider>
    </CrackWatchProvider>
  );
}
