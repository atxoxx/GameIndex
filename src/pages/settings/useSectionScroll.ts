import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const FLASH_CLASS = "settings-flash";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * useSectionScroll — URL-driven deep-linking inside a settings tab.
 *
 * Reads the `?section=` query param and, whenever it names one of the
 * section ids in `sectionIds`, scrolls that section into view and
 * briefly flashes an accent ring around it. The returned `target` lets
 * callers react too (e.g. auto-expanding an accordion tile before the
 * scroll lands).
 *
 * One navigation path: jump-bar chips, search results and direct
 * deep-links all go through the URL, so back/refresh/forward all behave.
 * Under `prefers-reduced-motion` the flash is skipped entirely (it is a
 * motion effect) and the scroll is instant.
 */
export function useSectionScroll(sectionIds: readonly string[]) {
  const [searchParams] = useSearchParams();
  const target = searchParams.get("section");

  useEffect(() => {
    if (!target || !sectionIds.includes(target)) return;

    const reduced = prefersReducedMotion();
    const startedAt = performance.now();
    let frame = 0;
    let cancelled = false;

    // Tabs are lazy chunks, so on a deep-link the section element can appear
    // a few frames after the page mounts. Poll for it briefly instead of
    // giving up on the first paint, then scroll + flash once it exists.
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(target);
      if (el) {
        if (!reduced) el.classList.add(FLASH_CLASS);
        el.scrollIntoView({
          behavior: reduced ? "auto" : "smooth",
          block: "start",
        });
        return;
      }
      if (performance.now() - startedAt < 2000) {
        frame = requestAnimationFrame(tryScroll);
      }
    };

    frame = requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    // Re-run whenever the target section changes (including first mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return target;
}
