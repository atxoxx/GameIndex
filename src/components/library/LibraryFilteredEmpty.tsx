import { useCallback, useRef, type MouseEvent } from "react";
import { useLanguage } from "../../context/LanguageContext";

interface LibraryFilteredEmptyProps {
  onReset: () => void;
}

/**
 * Empty state shown when the library has games but the active filters
 * match nothing. A small illustrated scene — floating cover tiles being
 * searched — replaces the flat icon, with a subtle pointer parallax on
 * the tile stack (disabled under prefers-reduced-motion).
 */
export default function LibraryFilteredEmpty({ onReset }: LibraryFilteredEmptyProps) {
  const { t } = useLanguage();
  const sceneRef = useRef<HTMLDivElement | null>(null);

  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const rect = scene.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    scene.style.setProperty("--lfe-x", x.toFixed(3));
    scene.style.setProperty("--lfe-y", y.toFixed(3));
  }, []);

  const handleMouseLeave = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.style.setProperty("--lfe-x", "0.5");
    scene.style.setProperty("--lfe-y", "0.5");
  }, []);

  return (
    <div className="lib-filtered-empty">
      <div
        className="lib-filtered-empty-scene"
        ref={sceneRef}
        onMouseMove={reduceMotion ? undefined : handleMouseMove}
        onMouseLeave={reduceMotion ? undefined : handleMouseLeave}
        aria-hidden="true"
      >
        <div className="lfe-tile lfe-tile--back" />
        <div className="lfe-tile lfe-tile--front">
          <span className="lfe-tile-play">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </span>
        </div>
        <div className="lfe-glass">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <span className="lfe-spark lfe-spark--1" />
        <span className="lfe-spark lfe-spark--2" />
        <span className="lfe-spark lfe-spark--3" />
      </div>
      <p className="lib-filtered-empty-title">{t("page.library.noFilterResultsTitle")}</p>
      <p className="lib-filtered-empty-subtitle">{t("page.library.noFilterResultsSubtitle")}</p>
      <button type="button" className="lib-filtered-empty-reset" onClick={onReset}>
        {t("page.library.clearFilters")}
      </button>
    </div>
  );
}
