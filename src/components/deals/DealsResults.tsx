import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import DealsEmptyState, { DealsErrorState } from "./DealsEmptyState";
import DealsSkeletonGrid from "./DealsSkeletonGrid";

interface DealsResultsProps<T> {
  loading: boolean;
  error: string | null;
  empty: boolean;
  /** Number of items after client-side filtering. */
  shown: number;
  /** Number of items before filtering. */
  total: number;
  density: ViewDensity;
  skeletonCount?: number;
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  emptyIcon: ReactNode;
  emptyMessage: string;
  onRetry: () => void;
  onReset: () => void;
}

/** Cards mounted per batch. */
const CHUNK = 36;
/** How far past the sentinel a batch preloads. */
const PRELOAD_PX = 700;

/**
 * DealsResults - the shared results region for every source tab.
 *
 * Owns the "showing X of Y" ledger, the loading/empty/error states, the grid
 * and incremental rendering. ITAD can return hundreds of grouped games, so only
 * the first batch is mounted; a passive scroll check appends more as the
 * sentinel approaches the viewport. Rendering every card up front was the main
 * source of the page's scroll jank.
 *
 * The check reads the sentinel's rect on scroll instead of relying on
 * IntersectionObserver: the embedded WebViews throttle IO callbacks in ways
 * that left long lists stuck at the first batch.
 */
export default function DealsResults<T>({
  loading,
  error,
  empty,
  shown,
  total,
  density,
  skeletonCount = 8,
  items,
  renderItem,
  emptyIcon,
  emptyMessage,
  onRetry,
  onReset,
}: DealsResultsProps<T>) {
  const { t } = useLanguage();
  const filtered = total > 0 && shown === 0;

  const [visible, setVisible] = useState(CHUNK);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // A new result set (search, filter, source refresh) starts from one batch.
  useEffect(() => {
    setVisible(CHUNK);
  }, [items]);

  const hasMore = visible < items.length;

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    let frame = 0;
    const check = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight;
      if (rect.top <= viewport + PRELOAD_PX) {
        setVisible((current) => Math.min(items.length, current + CHUNK));
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(check);
    };

    // `.app-main` owns the scroll; fall back to the window for other shells.
    let scroller: EventTarget = window;
    let parent = node.parentElement;
    while (parent) {
      const { overflowY } = getComputedStyle(parent);
      if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
        scroller = parent;
        break;
      }
      parent = parent.parentElement;
    }

    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [hasMore, items.length, visible]);

  return (
    <section className="deals-results">
      {!loading && !error && total > 0 && (
        <div className="deals-results__meta">
          <span>{t("deals.showingCount", { count: shown, total })}</span>
          {shown !== total && (
            <button type="button" className="deals-results__reset" onClick={onReset}>
              {t("deals.resetFilters")}
            </button>
          )}
        </div>
      )}

      {loading && <DealsSkeletonGrid density={density} count={skeletonCount} />}

      {!loading && error && <DealsErrorState message={error} onRetry={onRetry} />}

      {!loading && !error && (empty || filtered) && (
        <DealsEmptyState
          icon={emptyIcon}
          message={filtered ? t("deals.noMatchingDeals") : emptyMessage}
          onRetry={filtered ? undefined : onRetry}
        />
      )}

      {!loading && !error && !empty && shown > 0 && (
        <>
          <div className={`deals-grid deals-grid--${density}`}>
            {items.slice(0, visible).map((item, index) => renderItem(item, index))}
          </div>

          {hasMore && (
            <>
              <div
                ref={sentinelRef}
                className="deals-results__sentinel"
                aria-hidden="true"
              />
              <div className="deals-load-more">
                <button
                  type="button"
                  className="deals-state__action"
                  onClick={() =>
                    setVisible((current) => Math.min(items.length, current + CHUNK))
                  }
                >
                  {t("deals.loadMore")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
